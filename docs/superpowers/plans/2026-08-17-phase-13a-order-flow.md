# Phase 13A — Order flow, deposit CTA & order reference — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename `order_made` → `order_recorded`, insert `deposit_received` and `sent_to_vendor` into the fulfilment flow, add an editable `order_reference`, and delete the meaningless `install_width_cm` column.

**Architecture:** Three independent migrations, each followed by `npm run db:codegen`. The status change is enum-level and propagates through `STATUS_FLOW`; the four call sites that hardcode `"order_made"` and the two dashboard stat buckets are the only application code that must move with it. `order_reference` is a new nullable column with a partial unique index and one new Server Action. `install_width_cm` is removed from the column, the two Zod schemas, the value mapper, the form and the summary table.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Kysely migrations against Supabase Postgres, Zod, React Hook Form, Vitest (node env, pure-logic tests only — no database in the test run).

**Spec:** `docs/specs/phase-13-order-flow-and-manufacture.md` §3–6.

**Baseline before starting:** 19 test files, 236 tests, all passing.

**Known coverage gap, stated deliberately.** Spec §16 asks for a test that a new curtain
order and a new mesh order both land at `order_recorded`. `vitest.config.ts` runs a pure
`node` environment with no database and no Supabase session — Server Actions are not
reachable from the suite, and this project has never tested them. That row is therefore
covered by the compiler (Task 3 Step 3 — the renamed enum makes a stale literal a type
error), by grep (Task 3 Step 1), and by a manual pass (Task 10 Step 2.6). Do not fabricate
a unit test that mocks the database to close it.

---

## File Structure

**Created:**
- `data/migrations/20260817120000_order_flow_statuses.ts` — enum rename + two new values + transition validator
- `data/migrations/20260817121000_order_reference.ts` — `orders.order_reference` + partial unique index
- `data/migrations/20260817122000_drop_install_width.ts` — drops `windows.install_width_cm`
- `src/lib/status-flow.test.ts` — flow ordering and label/colour completeness
- `src/components/orders/order-reference-field.tsx` — inline edit for the reference

**Modified:**
- `src/lib/status-flow.ts` — three maps gain two members each
- `src/lib/actions/orders.ts` — two `"order_made"` literals; new `setOrderReference` action
- `src/lib/actions/mesh-orders.ts` — two `"order_made"` literals
- `src/app/(app)/orders/page.tsx` — dashboard stat buckets
- `src/app/(app)/orders/[orderId]/page.tsx` — deposit CTA label, reference field, reference in select
- `src/components/orders/advance-status-button.tsx` — optional `ctaLabel` prop
- `src/lib/validation/order.ts` — drop `install_width_cm`, add `orderReferenceSchema`
- `src/lib/orders/window-values.ts` + `.test.ts` — drop `install_width_cm`
- `src/components/orders/consultation-form/window-fields.tsx` — remove three inputs
- `src/components/orders/consultation-form/index.tsx`, `room-card.tsx` — remove defaults
- `src/components/orders/room-summary-card.tsx` — remove "Install W" column
- `src/app/(app)/orders/[orderId]/edit/page.tsx` — remove `install_width_cm` from select and mapping

---

## Task 1: Status enum migration

**Files:**
- Create: `data/migrations/20260817120000_order_flow_statuses.ts`

- [ ] **Step 1: Write the migration**

Create `data/migrations/20260817120000_order_flow_statuses.ts`:

```ts
import { sql, type Kysely } from "kysely";

// Phase 13A — the fulfilment flow started in the wrong place and skipped two
// real events. An order is *recorded*, not *made*, at creation: nothing has
// been manufactured and the company is waiting on a deposit. And the jump from
// "we took the order" straight to "we handed it to a freight partner" swallowed
// both the deposit arriving and the order going to the vendor who builds it.
//
// `rename value` rewrites every existing row, the orders.current_status default
// and every order_status_events row transparently — enum values are stored by
// internal id, not by text.
//
// IMPORTANT: Postgres forbids *using* an enum value in the same transaction
// that adds it, and the Kysely migrator wraps each migration in one. This
// migration therefore only adds the values; it never inserts or compares
// against them. Redefining validate_status_transition() below is safe because
// a plpgsql body is stored as text and its flow array is text[], not the enum.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter type public.fulfilment_status rename value 'order_made' to 'order_recorded'
  `.execute(db);

  await sql`
    alter type public.fulfilment_status add value 'deposit_received' after 'order_recorded'
  `.execute(db);

  await sql`
    alter type public.fulfilment_status add value 'sent_to_vendor' after 'deposit_received'
  `.execute(db);

  // Same ±1 logic as before; only the flow array changes.
  await sql`
    create or replace function public.validate_status_transition() returns trigger
    language plpgsql as $$
    declare
      v_current public.fulfilment_status;
      v_flow text[] := array[
        'order_recorded','deposit_received','sent_to_vendor',
        'sent_logistic','shipping_sg','delivered_checked','fulfilment','completed'
      ];
      v_current_idx int;
      v_new_idx int;
    begin
      select current_status into v_current from public.orders where id = new.order_id;
      v_current_idx := array_position(v_flow, v_current::text);
      v_new_idx := array_position(v_flow, new.status::text);

      if v_new_idx is null then
        raise exception 'unknown status';
      end if;

      if v_new_idx = v_current_idx then return new; end if;
      if v_new_idx = v_current_idx + 1 then return new; end if;
      if v_new_idx = v_current_idx - 1 then return new; end if;

      raise exception 'invalid status transition: % -> %', v_current, new.status;
    end
    $$
  `.execute(db);
}

// Postgres cannot drop a value from an enum. Reversing means rebuilding the
// type, which would fail against any row already sitting on a new value — so
// down() only restores the name and the old flow array, and refuses if the two
// new statuses are in use.
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    do $$
    begin
      if exists (
        select 1 from public.orders
        where current_status in ('deposit_received','sent_to_vendor')
      ) then
        raise exception 'cannot reverse: orders exist at deposit_received or sent_to_vendor';
      end if;
    end
    $$
  `.execute(db);

  await sql`
    alter type public.fulfilment_status rename value 'order_recorded' to 'order_made'
  `.execute(db);

  await sql`
    create or replace function public.validate_status_transition() returns trigger
    language plpgsql as $$
    declare
      v_current public.fulfilment_status;
      v_flow text[] := array['order_made','sent_logistic','shipping_sg','delivered_checked','fulfilment','completed'];
      v_current_idx int;
      v_new_idx int;
    begin
      select current_status into v_current from public.orders where id = new.order_id;
      v_current_idx := array_position(v_flow, v_current::text);
      v_new_idx := array_position(v_flow, new.status::text);

      if v_new_idx is null then
        raise exception 'unknown status';
      end if;

      if v_new_idx = v_current_idx then return new; end if;
      if v_new_idx = v_current_idx + 1 then return new; end if;
      if v_new_idx = v_current_idx - 1 then return new; end if;

      raise exception 'invalid status transition: % -> %', v_current, new.status;
    end
    $$
  `.execute(db);
}
```

- [ ] **Step 2: Apply the migration**

Run: `npm run db:migrate`
Expected: the migration name printed as executed, no error.

**If it fails with `ALTER TYPE ... ADD VALUE cannot run inside a transaction block`**, the migrator is on a Postgres older than 12 or the pool is misconfigured. Do not work around it by splitting the file arbitrarily — stop and report, because the fix changes the rest of the plan.

- [ ] **Step 3: Verify against the live database**

Run:
```bash
set -a && . ./.env && set +a && cat > ./.q-tmp.mts <<'EOF'
import { Pool } from "pg";
const p = new Pool({ connectionString: process.env.DATABASE_URL });
const e = await p.query("select unnest(enum_range(null::public.fulfilment_status))::text as v");
console.log(e.rows.map((r) => r.v));
const o = await p.query("select current_status, count(*)::int from public.orders group by 1");
console.log(o.rows);
await p.end();
EOF
npx tsx ./.q-tmp.mts; rm -f ./.q-tmp.mts
```

Expected: the eight values in flow order, and the 2 existing orders reading `order_recorded`.

- [ ] **Step 4: Regenerate types**

Run: `npm run db:codegen`
Expected: `src/lib/db/schema.ts` line 36 becomes a union containing `"order_recorded"`, `"deposit_received"` and `"sent_to_vendor"` and no longer containing `"order_made"`.

- [ ] **Step 5: Confirm the codebase now fails to compile**

Run: `npx tsc --noEmit`
Expected: FAIL, with errors at `src/lib/status-flow.ts`, `src/lib/actions/orders.ts`, `src/lib/actions/mesh-orders.ts` and `src/app/(app)/orders/page.tsx`. This is the type system finding every call site Task 2 and Task 3 must fix. Note the list — it should match §3.3 of the spec exactly.

- [ ] **Step 6: Commit**

```bash
git add data/migrations/20260817120000_order_flow_statuses.ts src/lib/db/schema.ts
git commit -m "feat(orders): rename order_made to order_recorded, add deposit_received and sent_to_vendor"
```

---

## Task 2: Status flow maps

**Files:**
- Modify: `src/lib/status-flow.ts`
- Test: `src/lib/status-flow.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/lib/status-flow.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  STATUS_COLOURS,
  STATUS_FLOW,
  STATUS_LABELS,
  nextStatus,
  statusIndex,
} from "./status-flow";

describe("STATUS_FLOW", () => {
  it("runs recorded → deposit → vendor → logistics → shipping → delivered → fulfilment → completed", () => {
    expect(STATUS_FLOW).toEqual([
      "order_recorded",
      "deposit_received",
      "sent_to_vendor",
      "sent_logistic",
      "shipping_sg",
      "delivered_checked",
      "fulfilment",
      "completed",
    ]);
  });

  it("labels and colours every status", () => {
    for (const s of STATUS_FLOW) {
      expect(STATUS_LABELS[s]).toBeTruthy();
      expect(STATUS_COLOURS[s]).toBeTruthy();
    }
  });
});

describe("nextStatus", () => {
  it("advances an order through the two new steps", () => {
    expect(nextStatus("order_recorded")).toBe("deposit_received");
    expect(nextStatus("deposit_received")).toBe("sent_to_vendor");
    expect(nextStatus("sent_to_vendor")).toBe("sent_logistic");
  });

  it("returns null at the end of the flow", () => {
    expect(nextStatus("completed")).toBeNull();
  });
});

describe("statusIndex", () => {
  it("orders vendor dispatch before logistics handover", () => {
    expect(statusIndex("sent_to_vendor")).toBeLessThan(
      statusIndex("sent_logistic"),
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/status-flow.test.ts`
Expected: FAIL — `STATUS_FLOW` still holds six members starting `order_made`.

- [ ] **Step 3: Update the maps**

In `src/lib/status-flow.ts`, replace the three exported constants:

```ts
export const STATUS_FLOW: FulfilmentStatus[] = [
  "order_recorded",
  "deposit_received",
  "sent_to_vendor",
  "sent_logistic",
  "shipping_sg",
  "delivered_checked",
  "fulfilment",
  "completed",
];

export const STATUS_LABELS: Record<FulfilmentStatus, string> = {
  order_recorded: "Order Recorded",
  deposit_received: "Deposit Received",
  sent_to_vendor: "Sent to Vendor",
  sent_logistic: "Sent to Logistic Partner",
  shipping_sg: "Shipping to SG",
  delivered_checked: "Delivered & Checked",
  fulfilment: "Fulfilment Arrangement",
  completed: "Completed",
};

export const STATUS_COLOURS: Record<FulfilmentStatus, string> = {
  order_recorded: "bg-slate-100 text-slate-700",
  deposit_received: "bg-amber-100 text-amber-700",
  sent_to_vendor: "bg-orange-100 text-orange-700",
  sent_logistic: "bg-indigo-100 text-indigo-700",
  shipping_sg: "bg-blue-100 text-blue-700",
  delivered_checked: "bg-emerald-100 text-emerald-700",
  fulfilment: "bg-purple-100 text-purple-700",
  completed: "bg-green-100 text-green-700",
};
```

`nextStatus` and `statusIndex` are unchanged.

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/lib/status-flow.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/status-flow.ts src/lib/status-flow.test.ts
git commit -m "feat(orders): extend status flow with deposit_received and sent_to_vendor"
```

---

## Task 3: Fix hardcoded statuses

Four call sites insert `"order_made"` directly, and the dashboard buckets two status groups by hand. Task 1 Step 5 already listed them via the compiler.

**Files:**
- Modify: `src/lib/actions/orders.ts:118`, `src/lib/actions/orders.ts:479`
- Modify: `src/lib/actions/mesh-orders.ts:127`, `src/lib/actions/mesh-orders.ts:326`
- Modify: `src/app/(app)/orders/page.tsx:61-71`

- [ ] **Step 1: Replace the four creation literals**

In both `src/lib/actions/orders.ts` and `src/lib/actions/mesh-orders.ts`, each site reads:

```ts
        status: "order_made",
```

Change every one to:

```ts
        status: "order_recorded",
```

There are exactly four. Verify with:

Run: `grep -rn '"order_made"' src/`
Expected: no output.

- [ ] **Step 2: Rebucket the dashboard stats**

In `src/app/(app)/orders/page.tsx`, the `awaiting_shipment` filter currently reads:

```ts
        .filterWhere("current_status", "in", [
          "order_made",
          "sent_logistic",
          "shipping_sg",
        ])
```

Replace with:

```ts
        // Manufactured or in transit. order_recorded and deposit_received are
        // deliberately excluded: an order with no deposit is not awaiting
        // shipment, which is what the pre-Phase-13 flow got wrong. Both remain
        // in "Active orders" and in the status filter.
        .filterWhere("current_status", "in", [
          "sent_to_vendor",
          "sent_logistic",
          "shipping_sg",
        ])
```

`ready_for_installation` (`delivered_checked`, `fulfilment`) is unchanged.

- [ ] **Step 3: Verify the whole project type-checks**

Run: `npx tsc --noEmit`
Expected: PASS, no output. If any error remains, it is a status call site the plan missed — fix it and note it.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS. 20 test files, 241 tests (236 baseline + 5 from Task 2).

- [ ] **Step 5: Commit**

```bash
git add src/lib/actions/orders.ts src/lib/actions/mesh-orders.ts "src/app/(app)/orders/page.tsx"
git commit -m "fix(orders): point creation and dashboard buckets at the new statuses"
```

---

## Task 4: Deposit CTA

The generic advance button becomes explicit about what it is doing at `order_recorded`. No schema, no new action, no new permission — `advanceOrderStatus` already requires ops or admin and already records actor and timestamp.

**Files:**
- Modify: `src/components/orders/advance-status-button.tsx`
- Modify: `src/app/(app)/orders/[orderId]/page.tsx:444`

- [ ] **Step 1: Add the optional label prop**

In `src/components/orders/advance-status-button.tsx`, extend `Props`:

```ts
type Props = {
  orderId: string;
  atEnd: boolean;
  nextLabel?: string;
  /** Overrides the generic "Advance →" wording. Used at order_recorded, where
   *  the action is specifically "the deposit has arrived". */
  ctaLabel?: string;
};
```

Destructure it: `export function AdvanceStatusButton({ orderId, atEnd, nextLabel, ctaLabel }: Props) {`

Replace the trigger button's label:

```tsx
        {pending ? "Saving…" : (ctaLabel ?? "Advance →")}
```

Replace the dialog title:

```tsx
            <DialogTitle>
              {ctaLabel ?? (nextLabel ? `Advance to ${nextLabel}` : "Advance status")}
            </DialogTitle>
```

Replace the submit button's label:

```tsx
                {pending ? "Saving…" : (ctaLabel ?? "Advance")}
```

- [ ] **Step 2: Pass it from the detail page**

In `src/app/(app)/orders/[orderId]/page.tsx`, inside the IIFE that already computes `nextLabel`, add below it:

```ts
          const ctaLabel =
            order.current_status === "order_recorded"
              ? "Record deposit received"
              : undefined;
```

Then add the prop to the `<AdvanceStatusButton>` element at line ~444:

```tsx
                  ctaLabel={ctaLabel}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Verify in the running app**

Run: `npm run dev`, open an order sitting at Order Recorded.
Expected: the primary button reads **Record deposit received**, the dialog title matches, and confirming moves the order to **Deposit Received**.

- [ ] **Step 5: Commit**

```bash
git add src/components/orders/advance-status-button.tsx "src/app/(app)/orders/[orderId]/page.tsx"
git commit -m "feat(orders): label the deposit step explicitly on the advance CTA"
```

---

## Task 5: `order_reference` migration

**Files:**
- Create: `data/migrations/20260817121000_order_reference.ts`

- [ ] **Step 1: Write the migration**

```ts
import { sql, type Kysely } from "kysely";

// Phase 13A — the number a vendor and a delivery driver actually quote back is
// not always DW-YYYY-NNNN. display_id stays exactly as it is: trigger-assigned,
// unique, and the order's identity across the dashboard and URLs — making it
// editable would make past orders hard to find. This is a second, optional,
// human-set identifier that prints on vendor documents.
//
// A partial unique index rather than a unique constraint: many orders may have
// no reference, but no two may share one.

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("orders")
    .addColumn("order_reference", "text")
    .execute();

  await sql`
    create unique index orders_order_reference_key
      on public.orders (order_reference)
      where order_reference is not null
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop index if exists public.orders_order_reference_key`.execute(db);
  await db.schema.alterTable("orders").dropColumn("order_reference").execute();
}
```

- [ ] **Step 2: Apply and regenerate**

Run: `npm run db:migrate && npm run db:codegen`
Expected: migration executed; `Orders` in `src/lib/db/schema.ts` gains `order_reference: string | null;`.

- [ ] **Step 3: Commit**

```bash
git add data/migrations/20260817121000_order_reference.ts src/lib/db/schema.ts
git commit -m "feat(orders): add optional order_reference"
```

---

## Task 6: `setOrderReference` action

**Files:**
- Modify: `src/lib/validation/order.ts`
- Modify: `src/lib/actions/orders.ts`
- Test: `src/lib/validation/order-reference.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/lib/validation/order-reference.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { orderReferenceSchema } from "./order";

describe("orderReferenceSchema", () => {
  it("trims surrounding whitespace", () => {
    const parsed = orderReferenceSchema.parse({
      orderId: "550e8400-e29b-41d4-a716-446655440000",
      reference: "  SJ-2026-118  ",
    });
    expect(parsed.reference).toBe("SJ-2026-118");
  });

  it("treats an empty string as clearing the reference", () => {
    const parsed = orderReferenceSchema.parse({
      orderId: "550e8400-e29b-41d4-a716-446655440000",
      reference: "   ",
    });
    expect(parsed.reference).toBeNull();
  });

  it("accepts an explicit null", () => {
    const parsed = orderReferenceSchema.parse({
      orderId: "550e8400-e29b-41d4-a716-446655440000",
      reference: null,
    });
    expect(parsed.reference).toBeNull();
  });

  it("rejects a reference longer than 64 characters", () => {
    expect(() =>
      orderReferenceSchema.parse({
        orderId: "550e8400-e29b-41d4-a716-446655440000",
        reference: "x".repeat(65),
      }),
    ).toThrow();
  });

  it("rejects a non-uuid order id", () => {
    expect(() =>
      orderReferenceSchema.parse({ orderId: "nope", reference: "A1" }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/validation/order-reference.test.ts`
Expected: FAIL — `orderReferenceSchema` is not exported.

- [ ] **Step 3: Add the schema**

Append to `src/lib/validation/order.ts`:

```ts
// Phase 13A — the vendor/delivery-facing identifier. Blank input clears it
// rather than storing an empty string, so the partial unique index only ever
// sees real values.
export const orderReferenceSchema = z.object({
  orderId: z.string().uuid(),
  reference: z
    .string()
    .max(64, "Reference must be 64 characters or fewer")
    .nullable()
    .transform((v) => {
      const trimmed = v?.trim() ?? "";
      return trimmed.length > 0 ? trimmed : null;
    }),
});
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/lib/validation/order-reference.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Add the Server Action**

Append to `src/lib/actions/orders.ts`:

```ts
export async function setOrderReference(input: unknown) {
  await requireRole(["ops", "admin"]);
  const parsed = orderReferenceSchema.parse(input);

  try {
    await db
      .updateTable("orders")
      .set({ order_reference: parsed.reference, updated_at: new Date() })
      .where("id", "=", parsed.orderId)
      .execute();
  } catch (e) {
    // 23505 = unique_violation on orders_order_reference_key.
    if (typeof e === "object" && e !== null && "code" in e && e.code === "23505") {
      throw new Error("That order reference is already used by another order.");
    }
    throw e;
  }

  revalidatePath(`/orders/${parsed.orderId}`);
  revalidatePath("/orders");
}
```

Add `orderReferenceSchema` to the existing import from `@/lib/validation/order`. `requireRole`, `db` and `revalidatePath` are already imported in this file.

> **Deliberately not status-gated.** The reference stays editable after the order
> locks in Phase 13B — it is a paperwork identifier, not a manufacturing input,
> and a vendor may ask for a renumber mid-production. See spec §19.3.

- [ ] **Step 6: Type-check and run the suite**

Run: `npx tsc --noEmit && npm test`
Expected: PASS. 21 files, 246 tests.

- [ ] **Step 7: Commit**

```bash
git add src/lib/validation/order.ts src/lib/validation/order-reference.test.ts src/lib/actions/orders.ts
git commit -m "feat(orders): add setOrderReference action with uniqueness handling"
```

---

## Task 7: `order_reference` UI

**Files:**
- Create: `src/components/orders/order-reference-field.tsx`
- Modify: `src/app/(app)/orders/[orderId]/page.tsx`

- [ ] **Step 1: Create the field component**

Create `src/components/orders/order-reference-field.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setOrderReference } from "@/lib/actions/orders";

type Props = {
  orderId: string;
  reference: string | null;
  canEdit: boolean;
};

// The vendor/delivery-facing identifier. Read-only text for anyone who cannot
// edit it, an inline input for ops and admin. Kept deliberately small — this is
// one field on a page that is otherwise a read surface.
export function OrderReferenceField({ orderId, reference, canEdit }: Props) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(reference ?? "");
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      try {
        await setOrderReference({ orderId, reference: value });
        toast.success("Order reference saved");
        setEditing(false);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not save reference");
      }
    });
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-slate-800">
          {reference || <span className="text-slate-400">Not set</span>}
        </span>
        {canEdit && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs text-teal-700 hover:text-teal-800 underline"
          >
            {reference ? "Change" : "Set"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={value}
        maxLength={64}
        onChange={(e) => setValue(e.target.value)}
        placeholder="e.g. SJ-2026-118"
        className="w-full px-2.5 py-1.5 border border-slate-200 rounded text-sm focus:outline-none focus:border-teal-500 bg-white"
      />
      <button
        type="button"
        onClick={save}
        disabled={pending}
        className="px-3 py-1.5 text-xs bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 text-white rounded font-medium"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        onClick={() => {
          setValue(reference ?? "");
          setEditing(false);
        }}
        disabled={pending}
        className="px-2 py-1.5 text-xs text-slate-600 hover:text-slate-900"
      >
        Cancel
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Select the column on the detail page**

In `src/app/(app)/orders/[orderId]/page.tsx`, add to the select list beside `"orders.display_id as display_id"` (line ~71):

```ts
      "orders.order_reference as order_reference",
```

- [ ] **Step 3: Render it in the Consultation panel**

Import at the top of the file:

```ts
import { OrderReferenceField } from "@/components/orders/order-reference-field";
```

Inside the "Consultation" `<section>`, above the existing Created entry, add:

```tsx
              <div>
                <dt className="text-xs text-slate-500">Order reference</dt>
                <dd className="mt-0.5">
                  <OrderReferenceField
                    orderId={order.id}
                    reference={order.order_reference}
                    canEdit={
                      session.profile.role === "ops" ||
                      session.profile.role === "admin"
                    }
                  />
                </dd>
              </div>
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Verify in the running app**

Run: `npm run dev`, open an order as an admin.
Expected: "Order reference — Not set · Set". Setting one persists across a reload. Setting the *same* reference on a second order shows the toast "That order reference is already used by another order." and does not save.

- [ ] **Step 6: Commit**

```bash
git add src/components/orders/order-reference-field.tsx "src/app/(app)/orders/[orderId]/page.tsx"
git commit -m "feat(orders): edit the order reference from the detail page"
```

---

## Task 8: Remove `install_width_cm` from application code

Do the code before the migration, so the column is unused by the time it is dropped.

**Files:**
- Modify: `src/lib/orders/window-values.ts`, `src/lib/orders/window-values.test.ts`
- Modify: `src/lib/validation/order.ts:56`
- Modify: `src/components/orders/consultation-form/window-fields.tsx` (3 blocks)
- Modify: `src/components/orders/consultation-form/index.tsx:56,68`
- Modify: `src/components/orders/consultation-form/room-card.tsx:95,106`
- Modify: `src/components/orders/room-summary-card.tsx` (1 type, 3 headers, 3 cells)
- Modify: `src/app/(app)/orders/[orderId]/page.tsx:155,301`
- Modify: `src/app/(app)/orders/[orderId]/edit/page.tsx:99,319,331,344`

> **Why this is safe.** The column originates in commit `9a97d0a` as an Alpine.js
> model in the HTML prototype, was copied into the phase-4 spec as a bare column,
> and is documented nowhere. No pricing, COGS, quote or staleness code reads it.
> Its whole lifecycle is form → store → one table column. Its 8 live values are
> `8` and `10` against windows 250–300cm wide — not widths. See spec §6.

- [ ] **Step 1: Update the value-mapper test first**

In `src/lib/orders/window-values.test.ts`, delete every `install_width_cm` line — there are four (2 inputs at lines ~18 and ~31, and 2 expectations at ~73 and ~104). Do not replace them with anything.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/orders/window-values.test.ts`
Expected: FAIL — the returned object still carries `install_width_cm`, so `toEqual` reports an unexpected property.

- [ ] **Step 3: Remove it from the mapper**

In `src/lib/orders/window-values.ts`, delete these three lines:

- `install_width_cm?: number | null;` from `WindowLike`
- `install_width_cm: number | null;` from `WindowColumnValues`
- `install_width_cm: win.install_width_cm ?? null,` from the `base` object

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/lib/orders/window-values.test.ts`
Expected: PASS.

- [ ] **Step 5: Remove it from validation**

In `src/lib/validation/order.ts`, delete line 56: `install_width_cm: optionalInt,`

- [ ] **Step 6: Remove the three form inputs**

In `src/components/orders/consultation-form/window-fields.tsx`, delete all three blocks of this shape (around lines 266–276, 336–346 and 412–421). Each is a wrapping `<div>` containing the "Installation Width (cm)" label and its `<input>`:

```tsx
        <div className="col-span-2 sm:col-span-2">
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Installation Width (cm)
          </label>
          <input
            type="number"
            className={INPUT_CLS}
            {...register(`${base}.install_width_cm`)}
          />
        </div>
```

Removing a cell leaves two of the three grids short. The exact fix per block:

**Regular block** (line ~209, `grid grid-cols-2 sm:grid-cols-6`). After removing the install-width cell the row holds Width (2) + Height (2) = 4 of 6. Widen both to fill it:

```tsx
        <div className="sm:col-span-3">   {/* Width (cm)  — was sm:col-span-2 */}
        <div className="sm:col-span-3">   {/* Height (cm) — was sm:col-span-2 */}
```

**Toilet block** (line ~293, `grid grid-cols-2 sm:grid-cols-4`). The install-width cell was `col-span-2 sm:col-span-1`, leaving Special Notes at 3 of 4. Widen Notes:

```tsx
        <div className="col-span-2 sm:col-span-4">   {/* Special Notes — was sm:col-span-3 */}
```

**Blind block** (line ~362, `grid grid-cols-2 sm:grid-cols-6`). **No span change needed.** Width (2) + Height (2) + Draw (2) = 6 once the install-width cell is gone; Draw simply moves up into the row.

- [ ] **Step 7: Remove the form defaults**

In `src/components/orders/consultation-form/index.tsx` delete lines 56 and 68 (`install_width_cm: null,`), and in `room-card.tsx` delete lines 95 and 106 (same).

- [ ] **Step 8: Remove the summary column**

In `src/components/orders/room-summary-card.tsx`:
- delete `install_width_cm: number | null;` from the window type (line ~9)
- delete the three `<th ...>Install W</th>` headers (lines ~78, ~124, ~153)
- delete the three matching `<td className="px-4 py-2">{w.install_width_cm ?? "—"}</td>` cells (lines ~90, ~138, ~175)

Each header and cell must be removed in matching pairs or the tables will misalign.

- [ ] **Step 9: Remove the remaining reads**

In `src/app/(app)/orders/[orderId]/page.tsx` delete line 155 (`"windows.install_width_cm as install_width_cm",`) and line 301 (`install_width_cm: w.install_width_cm,`).

In `src/app/(app)/orders/[orderId]/edit/page.tsx` delete line 99 (`"install_width_cm",`) and the three mapping lines at 319, 331 and 344 (`install_width_cm: w.install_width_cm ?? null,`).

- [ ] **Step 10: Verify nothing references it and the forms still look right**

Run: `grep -rn "install_width" src/`
Expected: **exactly one hit**, `src/lib/db/schema.ts:882`. That is the generated type, which Task 9 removes when it regenerates after dropping the column. Any other hit is a call site this step missed.

Run: `npx tsc --noEmit && npm test`
Expected: PASS. 21 files, 246 tests.

Run `npm run dev` and open a new consultation. Expected: each window row shows Width, Height and Special Notes with no gap where the removed field was, at both mobile and desktop widths.

- [ ] **Step 11: Commit**

```bash
git add -A src/
git commit -m "refactor(orders): remove install_width_cm, a prototype artefact with no consumer"
```

---

## Task 9: Drop the `install_width_cm` column

**Files:**
- Create: `data/migrations/20260817122000_drop_install_width.ts`

- [ ] **Step 1: Write the migration**

```ts
import { type Kysely } from "kysely";

// Phase 13A — install_width_cm never had a defined meaning.
//
// It originates in commit 9a97d0a as `win.installWidth`, an Alpine.js model in
// docs/prototype/consultation.html, and was copied into phase-4-consultation.md
// as a bare column. No spec, rule file or comment anywhere says what it
// measures. No pricing, COGS, quote or staleness code ever read it: its whole
// lifecycle was form -> store -> one display column.
//
// Its eight live values were 8 and 10, against windows 250-300cm wide. Those
// are not widths. Leaving an undefined field next to the Phase 13B
// manufacturing measurements is an invitation to mis-enter data.
//
// The values are not recoverable and are not worth recovering; down() restores
// the column shape only.

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("windows").dropColumn("install_width_cm").execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("windows")
    .addColumn("install_width_cm", "integer")
    .execute();
}
```

- [ ] **Step 2: Apply and regenerate**

Run: `npm run db:migrate && npm run db:codegen`
Expected: migration executed; `install_width_cm` gone from `Windows` in `src/lib/db/schema.ts`.

- [ ] **Step 3: Full verification**

Run: `grep -rn "install_width" src/`
Expected: no output at all. Historical migrations under `data/migrations/` still mention it and must **not** be edited — a migration that has already run is a historical record.

Run: `npx tsc --noEmit && npm test && npm run lint`
Expected: all PASS. 21 files, 246 tests.

- [ ] **Step 4: Commit**

```bash
git add data/migrations/20260817122000_drop_install_width.ts src/lib/db/schema.ts
git commit -m "feat(orders): drop the install_width_cm column"
```

---

## Task 10: End-to-end verification

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: PASS, including the type check.

- [ ] **Step 2: Walk the flow in the app**

Run `npm run dev` and, signed in as an admin:

1. Orders dashboard — the status filter offers eight statuses and the row does not overflow on a narrow viewport. The two existing orders read **Order Recorded**.
2. "Awaiting shipment" counts `0` (no order is at vendor, logistics or shipping yet).
3. Open an order → the primary button reads **Record deposit received** → confirm → badge becomes **Deposit Received**, timeline shows the event with your name and the timestamp.
4. Advance again → **Sent to Vendor**.
5. Set an order reference, reload, confirm it persisted.
6. Create a new consultation end to end — it lands at **Order Recorded**, and the window rows have no Installation Width field.

- [ ] **Step 3: Update the spec status line**

In `docs/specs/phase-13-order-flow-and-manufacture.md`, change the header line to:

```markdown
**Status:** 13A implemented 2026-08-17; 13B specified, not implemented; 13C blocked on a vendor Excel sample
```

- [ ] **Step 4: Commit**

```bash
git add docs/specs/phase-13-order-flow-and-manufacture.md
git commit -m "docs(specs): mark phase 13A implemented"
```

---

## Out of scope for this plan

Phase 13B (allowance config, manufacture measurements, reconciliation view, locking, costing) gets its own plan once 13A is verified against the live database. Phase 13C remains blocked on a sample vendor Excel.
