# Phase 13B — Manufacturing measurements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a deliberate, reviewable, recorded step between "deposit received" and "sent to vendor" where manufacturing dimensions are derived from the measured ones, inspected, adjusted if needed, and frozen — then lock the order and cost COGS off the frozen numbers.

**Architecture:** Two new tables. `manufacture_allowances` holds one signed width/height delta per product line, edited on a new Product tab. `manufacture_measurements` holds one row per window *or* mesh panel, written only at confirmation, snapshotting the source dimensions alongside the applied delta. A new reconciliation route shows measured-vs-manufacturing side by side with the delta made unmissable; confirming writes the rows and advances the order to `sent_to_vendor` in one transaction. From that status the whole order is frozen at the action, UI and RLS layers. Finally the pricing calculator gains a cost-side dimension so COGS reflects what is actually being made, while the customer's quoted price stays exactly where it was.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Kysely migrations against Supabase Postgres, Zod, Tailwind + shadcn/ui, Vitest (node env, pure-logic tests only — no database, no React rendering in the suite).

**Spec:** `docs/specs/phase-13-order-flow-and-manufacture.md` §7–§14.

**Branch:** `phase-13a-order-flow` (continuing on it deliberately — 13A is unmerged and 13B builds on its statuses).

**Baseline before starting:** 21 test files, 247 tests, all passing. `npx tsc --noEmit`, `npm run build` and `npm run lint` clean (lint has one pre-existing warning in `.remember/tmp/last-ndc.ts` — ignore it, do not touch that file).

**Migration numbering:** the latest executed migration is `20260817152000_drop_install_width`. The Kysely migrator **rejects any new migration whose filename sorts before an already-executed one**, so every new file here is numbered `202608181…` upward. Do not renumber lower.

---

## Known constraints, stated once

- **Server Actions are not unit-testable here.** `vitest.config.ts` is a pure `node` environment with no database and no Supabase session, and this project has never tested actions. Every task below tests the *pure logic* it can (allowance resolution, delta maths, Zod schemas, lock predicates) and verifies the action layer by type-check plus the manual pass in Task 15. **Do not fabricate a mocked-database test to close that gap.**
- **React components are not unit-testable here** for the same reason. Do not add a jsdom/React testing environment.
- **Money is integer cents. Dimensions are integer centimetres.** Never floats.
- Commit messages must NOT include AI attribution or a `Co-Authored-By` trailer.
- Do not push. Do not switch branches.

---

## File Structure

**Created:**
- `data/migrations/202608181000_manufacture_allowances.ts`
- `data/migrations/202608181100_manufacture_measurements.ts`
- `data/migrations/202608181200_lock_sent_orders.ts` — RLS status predicates
- `src/lib/manufacture/allowance.ts` + `.test.ts` — resolution and delta maths (pure)
- `src/lib/manufacture/load.ts` — loads an order's line items for the view and the action
- `src/lib/validation/manufacture.ts` + `.test.ts`
- `src/lib/actions/manufacture.ts` — allowance save, confirm, amend
- `src/app/(app)/admin/product/allowances/page.tsx`
- `src/components/manufacture/allowances-table.tsx`
- `src/app/(app)/orders/[orderId]/manufacture/page.tsx`
- `src/components/manufacture/reconciliation.tsx` — the compare grid + confirm footer
- `src/components/manufacture/amend-dialog.tsx`

**Modified:**
- `src/lib/status-flow.ts` — `isLocked` helper
- `src/components/admin/product-tabs.tsx` — Allowances tab
- `src/lib/actions/orders.ts`, `src/lib/actions/mesh-orders.ts` — lock guards
- `src/app/(app)/orders/[orderId]/page.tsx` — lock notice, manufacture entry point
- `src/app/(app)/orders/[orderId]/edit/page.tsx` — lock redirect
- `src/lib/pricing/calculator.ts` + `.test.ts` — `costWidthCm`
- `src/lib/pricing/mesh-calculator.ts` + `.test.ts` — cost-side dimensions
- `src/lib/pricing/order-quote.ts` — feed manufacturing dims into costing

---

## Task 1: Allowances table

**Files:** Create `data/migrations/202608181000_manufacture_allowances.ts`

- [ ] **Step 1: Write the migration**

```ts
import { sql, type Kysely } from "kysely";

// Phase 13B — the manufacturing allowance.
//
// A consultant measures the window opening. The vendor needs something else:
// the opening minus a hem allowance down the height and a clearance allowance
// across the width. Until now that arithmetic happened in someone's head on the
// way into a spreadsheet, with no record of what was sent or why.
//
// Keyed by PRODUCT LINE only — curtain, blind, mesh. Not per series, not per
// vendor, not per blind type. That is a deliberate product decision: three
// numbers a human can hold in their head beat a grid nobody keeps current.
//
// Deltas are stored SIGNED and NEGATIVE: -4 means "four centimetres shorter
// than measured". Storing a signed number rather than a magnitude means a
// future positive allowance needs no schema change and no interpretation flag.
//
// NULL means UNCONFIGURED, which is different from 0 (measured as-is). Curtain
// ships with the known values; blind and mesh are left null on purpose so an
// admin has to enter them, and an order containing an unconfigured line cannot
// be confirmed (see confirmManufactureMeasurements).

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("manufacture_allowances")
    .addColumn("product_line", "text", (c) => c.primaryKey())
    .addColumn("width_delta_cm", "integer")
    .addColumn("height_delta_cm", "integer")
    .addColumn("updated_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_by", "uuid", (c) => c.references("profiles.id"))
    .addCheckConstraint(
      "manufacture_allowances_product_line_check",
      sql`product_line in ('curtain','blind','mesh')`,
    )
    .execute();

  await sql`
    create trigger manufacture_allowances_set_updated_at
      before update on public.manufacture_allowances
      for each row execute function public.set_updated_at()
  `.execute(db);

  // Curtain is seeded with the values the business already uses. Blind and mesh
  // are deliberately null — see the header comment.
  await sql`
    insert into public.manufacture_allowances (product_line, width_delta_cm, height_delta_cm)
    values ('curtain', -2, -4), ('blind', null, null), ('mesh', null, null)
  `.execute(db);

  await sql`alter table public.manufacture_allowances enable row level security`.execute(db);
  await sql`
    create policy "manufacture_allowances_select_authenticated"
      on public.manufacture_allowances for select to authenticated using (true)
  `.execute(db);
  await sql`
    create policy "manufacture_allowances_update_admin"
      on public.manufacture_allowances for update to authenticated
      using (public.is_admin()) with check (public.is_admin())
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("manufacture_allowances").execute();
}
```

> No insert or delete policy: the three rows are seeded by this migration and
> are the complete set. Admins edit them; nobody adds or removes a product line
> at runtime.

- [ ] **Step 2: Apply and regenerate**

Run: `npm run db:migrate && npm run db:codegen`
Expected: migration executed; `ManufactureAllowances` appears in `src/lib/db/schema.ts` and in the `DB` interface.

- [ ] **Step 3: Verify against the live database**

Create a temp script IN THE PROJECT ROOT (so `pg` resolves) with a `.mts` extension (so top-level await works), run with `npx tsx`, then DELETE it:

```bash
set -a && . ./.env && set +a && cat > ./.q-tmp.mts <<'EOF'
import { Pool } from "pg";
const p = new Pool({ connectionString: process.env.DATABASE_URL });
console.table((await p.query("select * from public.manufacture_allowances order by product_line")).rows);
await p.end();
EOF
npx tsx ./.q-tmp.mts; rm -f ./.q-tmp.mts
```

Expected: three rows — `blind (null, null)`, `curtain (-2, -4)`, `mesh (null, null)`.

- [ ] **Step 4: Commit**

```bash
git add data/migrations/202608181000_manufacture_allowances.ts src/lib/db/schema.ts
git commit -m "feat(manufacture): add per-product-line manufacturing allowances"
```

---

## Task 2: Allowance resolution and delta maths

Pure logic, fully testable. Everything downstream depends on it, so it lands before any UI.

**Files:** Create `src/lib/manufacture/allowance.ts` and `src/lib/manufacture/allowance.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/manufacture/allowance.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  applyAllowance,
  type Allowance,
  type AllowanceBook,
  resolveAllowance,
} from "./allowance";

const BOOK: AllowanceBook = {
  curtain: { widthDeltaCm: -2, heightDeltaCm: -4 },
  blind: null,
  mesh: { widthDeltaCm: 0, heightDeltaCm: -1 },
};

describe("resolveAllowance", () => {
  it("returns the configured allowance for a line", () => {
    expect(resolveAllowance(BOOK, "curtain")).toEqual({
      widthDeltaCm: -2,
      heightDeltaCm: -4,
    });
  });

  it("returns null for an unconfigured line", () => {
    expect(resolveAllowance(BOOK, "blind")).toBeNull();
  });

  it("treats a zero allowance as configured, not missing", () => {
    expect(resolveAllowance(BOOK, "mesh")).toEqual({
      widthDeltaCm: 0,
      heightDeltaCm: -1,
    });
  });
});

describe("applyAllowance", () => {
  const curtain: Allowance = { widthDeltaCm: -2, heightDeltaCm: -4 };

  it("subtracts the delta from both dimensions", () => {
    expect(applyAllowance({ widthCm: 300, heightCm: 240 }, curtain)).toEqual({
      sourceWidthCm: 300,
      sourceHeightCm: 240,
      widthDeltaCm: -2,
      heightDeltaCm: -4,
      mfgWidthCm: 298,
      mfgHeightCm: 236,
    });
  });

  it("leaves dimensions untouched on a zero allowance", () => {
    const zero: Allowance = { widthDeltaCm: 0, heightDeltaCm: 0 };
    const out = applyAllowance({ widthCm: 150, heightCm: 200 }, zero);
    expect(out.mfgWidthCm).toBe(150);
    expect(out.mfgHeightCm).toBe(200);
  });

  it("returns null when a source dimension is missing", () => {
    expect(applyAllowance({ widthCm: null, heightCm: 240 }, curtain)).toBeNull();
    expect(applyAllowance({ widthCm: 300, heightCm: null }, curtain)).toBeNull();
  });

  it("returns null when a source dimension is not positive", () => {
    expect(applyAllowance({ widthCm: 0, heightCm: 240 }, curtain)).toBeNull();
    expect(applyAllowance({ widthCm: 300, heightCm: -5 }, curtain)).toBeNull();
  });
});

describe("applyAllowance — the allowance can exceed the opening", () => {
  it("reports a non-manufacturable result rather than a negative dimension", () => {
    // A 3cm-wide window minus a 4cm allowance is not something a vendor can
    // build. It must surface as a problem for a human, not as -1.
    const out = applyAllowance(
      { widthCm: 3, heightCm: 240 },
      { widthDeltaCm: -4, heightDeltaCm: -4 },
    );
    expect(out).not.toBeNull();
    expect(out!.mfgWidthCm).toBe(-1);
    expect(isManufacturable(out!)).toBe(false);
  });

  it("accepts a result where both dimensions stay positive", () => {
    const out = applyAllowance(
      { widthCm: 300, heightCm: 240 },
      { widthDeltaCm: -2, heightDeltaCm: -4 },
    );
    expect(isManufacturable(out!)).toBe(true);
  });
});
```

Add `isManufacturable` to the import list at the top of the file.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/manufacture/allowance.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the implementation**

Create `src/lib/manufacture/allowance.ts`:

```ts
import type { CurtainProductLine } from "@/lib/db/schema";

// The three lines an allowance can be configured for. Curtains and blinds are
// the two curtain_series product lines; mesh is its own product.
export type AllowanceLine = CurtainProductLine | "mesh";

export type Allowance = {
  widthDeltaCm: number;
  heightDeltaCm: number;
};

// null means UNCONFIGURED. A configured allowance of 0/0 is a real answer
// ("manufacture at the measured size") and must not be confused with it.
export type AllowanceBook = Record<AllowanceLine, Allowance | null>;

export function resolveAllowance(
  book: AllowanceBook,
  line: AllowanceLine,
): Allowance | null {
  return book[line] ?? null;
}

export type SourceDims = {
  widthCm: number | null;
  heightCm: number | null;
};

export type AppliedAllowance = {
  sourceWidthCm: number;
  sourceHeightCm: number;
  widthDeltaCm: number;
  heightDeltaCm: number;
  mfgWidthCm: number;
  mfgHeightCm: number;
};

/**
 * Apply an allowance to a measured opening.
 *
 * Returns null when the opening was never measured — that is a data problem
 * upstream, not an arithmetic one. When the opening IS measured, the result is
 * always returned even if the allowance swallows it, so the caller can show a
 * human the impossible number rather than silently clamping it. Use
 * `isManufacturable` to gate on that.
 */
export function applyAllowance(
  dims: SourceDims,
  allowance: Allowance,
): AppliedAllowance | null {
  const { widthCm, heightCm } = dims;
  if (widthCm == null || heightCm == null) return null;
  if (widthCm <= 0 || heightCm <= 0) return null;

  return {
    sourceWidthCm: widthCm,
    sourceHeightCm: heightCm,
    widthDeltaCm: allowance.widthDeltaCm,
    heightDeltaCm: allowance.heightDeltaCm,
    mfgWidthCm: widthCm + allowance.widthDeltaCm,
    mfgHeightCm: heightCm + allowance.heightDeltaCm,
  };
}

// A vendor cannot build a panel with a dimension of zero or less.
export function isManufacturable(a: AppliedAllowance): boolean {
  return a.mfgWidthCm > 0 && a.mfgHeightCm > 0;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/lib/manufacture/allowance.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/manufacture/allowance.ts src/lib/manufacture/allowance.test.ts
git commit -m "feat(manufacture): allowance resolution and delta arithmetic"
```

---

## Task 3: Allowance validation + save action

**Files:** Create `src/lib/validation/manufacture.ts`, `src/lib/validation/manufacture.test.ts`, `src/lib/actions/manufacture.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/validation/manufacture.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { allowanceSchema } from "./manufacture";

describe("allowanceSchema", () => {
  it("accepts a negative delta pair", () => {
    expect(
      allowanceSchema.parse({
        productLine: "curtain",
        widthDeltaCm: -2,
        heightDeltaCm: -4,
      }),
    ).toEqual({ productLine: "curtain", widthDeltaCm: -2, heightDeltaCm: -4 });
  });

  it("accepts zero", () => {
    const out = allowanceSchema.parse({
      productLine: "mesh",
      widthDeltaCm: 0,
      heightDeltaCm: 0,
    });
    expect(out.widthDeltaCm).toBe(0);
  });

  it("accepts a positive delta, since the sign is meaningful", () => {
    const out = allowanceSchema.parse({
      productLine: "blind",
      widthDeltaCm: 1,
      heightDeltaCm: 2,
    });
    expect(out.widthDeltaCm).toBe(1);
  });

  it("rejects an unknown product line", () => {
    expect(() =>
      allowanceSchema.parse({
        productLine: "awning",
        widthDeltaCm: 0,
        heightDeltaCm: 0,
      }),
    ).toThrow();
  });

  it("rejects a non-integer delta", () => {
    expect(() =>
      allowanceSchema.parse({
        productLine: "curtain",
        widthDeltaCm: -2.5,
        heightDeltaCm: -4,
      }),
    ).toThrow();
  });

  it("rejects an implausibly large delta", () => {
    expect(() =>
      allowanceSchema.parse({
        productLine: "curtain",
        widthDeltaCm: -500,
        heightDeltaCm: -4,
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/validation/manufacture.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the schema**

Create `src/lib/validation/manufacture.ts`:

```ts
import { z } from "zod";

export const ALLOWANCE_LINES = ["curtain", "blind", "mesh"] as const;

// Bounded at ±100cm. A metre of allowance is not a plausible hem or clearance;
// anything larger is a typo, and catching it here is cheaper than catching it
// on a vendor's cutting table.
const deltaCm = z
  .number()
  .int("Allowance must be a whole number of centimetres")
  .min(-100, "Allowance must be between -100 and 100 cm")
  .max(100, "Allowance must be between -100 and 100 cm");

export const allowanceSchema = z.object({
  productLine: z.enum(ALLOWANCE_LINES),
  widthDeltaCm: deltaCm,
  heightDeltaCm: deltaCm,
});
```

Match the Zod idioms already used in `src/lib/validation/order.ts` — this project is on Zod v4. If any construct above does not behave as the tests require under this version, adapt it so the TESTS pass; the tests define the contract.

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/lib/validation/manufacture.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the save action**

Create `src/lib/actions/manufacture.ts`:

```ts
"use server";

import "server-only";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";
import { userMessage } from "@/lib/errors";
import { allowanceSchema } from "@/lib/validation/manufacture";

export async function saveManufactureAllowance(input: unknown): Promise<void> {
  const session = await requireRole(["admin"]);
  const parsed = allowanceSchema.parse(input);

  try {
    await db
      .updateTable("manufacture_allowances")
      .set({
        width_delta_cm: parsed.widthDeltaCm,
        height_delta_cm: parsed.heightDeltaCm,
        updated_by: session.user.id,
      })
      .where("product_line", "=", parsed.productLine)
      .execute();
  } catch (e) {
    throw new Error(userMessage(e, "Could not save the allowance."));
  }

  revalidatePath("/admin/product/allowances");
}
```

`updated_at` is stamped by the `manufacture_allowances_set_updated_at` trigger — do not set it here. Confirm `requireRole` returns a session with `user.id` by reading a neighbouring action; if the shape differs, match the neighbour.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: PASS. 23 files, 262 tests (247 + 9 from Task 2 + 6 here).

- [ ] **Step 7: Commit**

```bash
git add src/lib/validation/manufacture.ts src/lib/validation/manufacture.test.ts src/lib/actions/manufacture.ts
git commit -m "feat(manufacture): validate and save allowances"
```

---

## Task 4: Allowances admin tab

**Files:** Create `src/app/(app)/admin/product/allowances/page.tsx` and `src/components/manufacture/allowances-table.tsx`; modify `src/components/admin/product-tabs.tsx`

- [ ] **Step 1: Add the tab**

In `src/components/admin/product-tabs.tsx`, append to `TABS`:

```ts
  { href: "/admin/product/allowances", label: "Allowances" },
```

- [ ] **Step 2: Build the page**

Create `src/app/(app)/admin/product/allowances/page.tsx` as a Server Component. The `ProductLayout` above it already does `requireRole(["admin"])`, so the page does not repeat it. Load all three rows ordered by a fixed display order (Curtains, Blinds, Mesh — not alphabetical, which would put Blinds first and read oddly against the other tabs) and render `<AllowancesTable>`.

```tsx
import { db } from "@/lib/db/kysely";
import { AllowancesTable } from "@/components/manufacture/allowances-table";

export const metadata = { title: "Allowances — Drapeworks CRM" };

const ORDER = ["curtain", "blind", "mesh"] as const;

export default async function AllowancesPage() {
  const rows = await db
    .selectFrom("manufacture_allowances")
    .select(["product_line", "width_delta_cm", "height_delta_cm"])
    .execute();

  const byLine = new Map(rows.map((r) => [r.product_line, r]));
  const ordered = ORDER.map((line) => ({
    productLine: line,
    widthDeltaCm: byLine.get(line)?.width_delta_cm ?? null,
    heightDeltaCm: byLine.get(line)?.height_delta_cm ?? null,
  }));

  return <AllowancesTable rows={ordered} />;
}
```

- [ ] **Step 3: Build the table component**

Create `src/components/manufacture/allowances-table.tsx` as a `"use client"` component. Requirements — follow `src/components/mesh/mesh-minimums-grid.tsx` for the house pattern (draft state separate from saved state, save only what changed, `useTransition`, sonner toasts, `router.refresh()`):

- Three rows, labelled **Curtains / Blinds / Mesh**.
- Two numeric inputs per row: **Width** and **Height**, accepting a signed integer.
- An unconfigured row (both null) renders an explicit **"Not set"** state and a short warning that orders containing that product line cannot be sent to a vendor until it is filled in.
- A single Save action per row calling `saveManufactureAllowance`.
- Render a stored `-4` as **`−4 cm`** for reading, but keep the input a plain signed number so typing is unambiguous.
- Explain in a short header paragraph what the numbers mean: *the manufacturing size is the measured opening plus this delta, so a negative number makes the piece smaller.* This is the one screen where that has to be unmissable.

Match the surrounding admin pages for layout, spacing and the teal-600 accent.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean (bar the known pre-existing warning).

Run `npm run dev` and open `/admin/product/allowances`. Expected: Curtains shows −2 / −4; Blinds and Mesh show "Not set" with the warning; editing and saving Blinds persists across a reload; the tab is highlighted in the Product sub-nav.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/admin/product/allowances/page.tsx" src/components/manufacture/allowances-table.tsx src/components/admin/product-tabs.tsx
git commit -m "feat(manufacture): allowances tab under Product"
```

---

## Task 5: Manufacture measurements table

**Files:** Create `data/migrations/202608181100_manufacture_measurements.ts`

- [ ] **Step 1: Write the migration**

```ts
import { sql, type Kysely } from "kysely";

// Phase 13B — what we are actually going to build, as opposed to what we
// measured.
//
// One row per line item: a window OR a mesh panel, never both, enforced by a
// check constraint. One polymorphic table rather than two because the
// reconciliation screen, the costing lookup and the vendor sheet all want a
// single uniform list; two tables would double every code path for no gain.
//
// order_id is denormalised (it is reachable via window -> room -> order)
// because every read is by order, and the alternative is a three-table join on
// every one of them.
//
// source_width_cm / source_height_cm are a SNAPSHOT taken at confirmation, not
// a reference. windows.width_cm is never modified — this is a second set of
// data, not a replacement — but the record has to stay truthful on its own
// terms, so that "what did we send the vendor, and what did we base it on" does
// not depend on the source row having survived unchanged.
//
// Rows are written on confirmation only. The reconciliation screen computes
// candidates live and holds overrides in component state; nothing is persisted
// until a human confirms.

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("manufacture_measurements")
    .addColumn("id", "uuid", (c) =>
      c.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("order_id", "uuid", (c) =>
      c.notNull().references("orders.id").onDelete("cascade"),
    )
    .addColumn("window_id", "uuid", (c) =>
      c.references("windows.id").onDelete("cascade"),
    )
    .addColumn("mesh_panel_id", "uuid", (c) =>
      c.references("mesh_panels.id").onDelete("cascade"),
    )
    .addColumn("source_width_cm", "integer", (c) => c.notNull())
    .addColumn("source_height_cm", "integer", (c) => c.notNull())
    .addColumn("width_delta_cm", "integer", (c) => c.notNull())
    .addColumn("height_delta_cm", "integer", (c) => c.notNull())
    .addColumn("mfg_width_cm", "integer", (c) => c.notNull())
    .addColumn("mfg_height_cm", "integer", (c) => c.notNull())
    .addColumn("is_overridden", "boolean", (c) => c.notNull().defaultTo(false))
    .addColumn("override_reason", "text")
    .addColumn("confirmed_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addColumn("confirmed_by", "uuid", (c) => c.references("profiles.id"))
    .addColumn("updated_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      "mm_exactly_one_line_item",
      sql`(window_id is not null and mesh_panel_id is null)
       or (window_id is null and mesh_panel_id is not null)`,
    )
    .addCheckConstraint(
      "mm_override_has_reason",
      sql`not is_overridden
       or (override_reason is not null and length(trim(override_reason)) > 0)`,
    )
    .addCheckConstraint(
      "mm_positive_manufacturing_dims",
      sql`mfg_width_cm > 0 and mfg_height_cm > 0`,
    )
    .execute();

  await sql`
    create unique index mm_window_key on public.manufacture_measurements (window_id)
      where window_id is not null
  `.execute(db);
  await sql`
    create unique index mm_mesh_panel_key on public.manufacture_measurements (mesh_panel_id)
      where mesh_panel_id is not null
  `.execute(db);
  await sql`
    create index mm_order_idx on public.manufacture_measurements (order_id)
  `.execute(db);

  await sql`
    create trigger manufacture_measurements_set_updated_at
      before update on public.manufacture_measurements
      for each row execute function public.set_updated_at()
  `.execute(db);

  await sql`alter table public.manufacture_measurements enable row level security`.execute(db);
  await sql`
    create policy "manufacture_measurements_select_authenticated"
      on public.manufacture_measurements for select to authenticated using (true)
  `.execute(db);
  await sql`
    create policy "manufacture_measurements_insert_ops_admin"
      on public.manufacture_measurements for insert to authenticated
      with check (public.is_ops() or public.is_admin())
  `.execute(db);
  await sql`
    create policy "manufacture_measurements_update_admin"
      on public.manufacture_measurements for update to authenticated
      using (public.is_admin()) with check (public.is_admin())
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("manufacture_measurements").execute();
}
```

> **No delete policy.** Nothing hard-deletes here — an amendment updates in
> place and writes an audit note to the status timeline. Ops may confirm; only
> an admin may amend afterwards.

- [ ] **Step 2: Apply, regenerate, verify**

Run: `npm run db:migrate && npm run db:codegen`

Then verify the constraints actually bite. Create a temp `.mts` script in the project root, run it, delete it. Inside a transaction you **roll back**, confirm each of these is REJECTED:
- a row with both `window_id` and `mesh_panel_id` set
- a row with neither set
- `is_overridden = true` with a null or blank `override_reason`
- `mfg_width_cm = 0`
- two rows for the same `window_id`

And confirm a well-formed row is ACCEPTED. Report exactly what happened for each. Roll back — leave no data behind.

- [ ] **Step 3: Commit**

```bash
git add data/migrations/202608181100_manufacture_measurements.ts src/lib/db/schema.ts
git commit -m "feat(manufacture): add manufacture_measurements"
```

---

## Task 6: Load an order's line items

A single loader used by both the reconciliation page and the confirm action, so the two can never disagree about what an order contains.

**Files:** Create `src/lib/manufacture/load.ts`

- [ ] **Step 1: Write the loader**

Create `src/lib/manufacture/load.ts` exporting:

```ts
export type ManufactureLine = {
  /** Stable id for the row: the window id or the mesh panel id. */
  lineId: string;
  kind: "window" | "mesh_panel";
  roomLabel: string;
  roomPosition: number;
  position: number;
  /** Which allowance applies. A window carrying a blind resolves to "blind". */
  line: AllowanceLine;
  /** What the piece is, for display: series/type labels, verbatim. */
  description: string | null;
  widthCm: number | null;
  heightCm: number | null;
};

export async function loadManufactureLines(orderId: string): Promise<ManufactureLine[]>;
export async function loadAllowanceBook(): Promise<AllowanceBook>;
```

Implementation notes — read `src/app/(app)/orders/[orderId]/page.tsx` around lines 120–200 for the existing room/window/mesh-panel query shape and copy its join structure rather than inventing one:

- Order rooms by `rooms.position`, then line items by `position`, so the screen reads top-to-bottom like the order.
- `line` resolution for a window: if `blind_type_id` is set → `"blind"`; otherwise `"curtain"`. For a mesh panel → `"mesh"`. **A window is one covering** — day/night curtains or a blind, never a mix — so this is a clean either/or, not a priority list.
- `description` joins the catalogue by id regardless of `is_active`, matching the detail page, so an archived series still renders on an existing order instead of a blank.
- Catalogue labels are rendered **verbatim** — never strip a prefix or normalise case.
- Mesh panels only exist on an order whose `product_line` is `'mesh'`; windows only on a curtain order. Read `orders.product_line` once and query only the relevant table.

`loadAllowanceBook` reads all three `manufacture_allowances` rows and returns an `AllowanceBook` keyed by line, with `null` for any row whose deltas are null.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: clean.

This module is a database reader, so it has no unit test — see "Known constraints". It is exercised by Task 15.

- [ ] **Step 3: Commit**

```bash
git add src/lib/manufacture/load.ts
git commit -m "feat(manufacture): load an order's manufacturable line items"
```

---

## Task 7: Confirm schema and preconditions

**Files:** Modify `src/lib/validation/manufacture.ts` and `src/lib/validation/manufacture.test.ts`; create `src/lib/manufacture/preconditions.ts` + `.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/validation/manufacture.test.ts` a `describe("confirmManufactureSchema")` covering: a minimal valid payload (order uuid + one line with no override); an override with width, height and a reason; an override **without** a reason is REJECTED; a blank/whitespace reason on an override is REJECTED; a non-uuid order id is REJECTED; an empty `lines` array is REJECTED (there is nothing to confirm); a non-integer override dimension is REJECTED; a zero or negative override dimension is REJECTED.

Create `src/lib/manufacture/preconditions.test.ts` covering `checkConfirmPreconditions(lines, book, status)`, which returns `{ ok: true }` or `{ ok: false, reasons: string[] }`:

- refuses when the order status is not `deposit_received`, naming the current status
- refuses when a line's product line has a null allowance, **naming which** ("Blind allowance is not configured…")
- refuses when a line has a null or non-positive width or height, naming the room and position
- refuses when a computed manufacturing dimension is `≤ 0` and no override was supplied
- **accepts** a line whose computed dimension is `≤ 0` when an override with a reason IS supplied — that is exactly the case overrides exist for
- accepts a well-formed order and returns `ok: true`
- reports **all** failing reasons, not just the first — a user fixing one problem at a time is a bad experience

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/lib/validation/manufacture.test.ts src/lib/manufacture/preconditions.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add `confirmManufactureSchema` to `src/lib/validation/manufacture.ts`:

```ts
export const manufactureLineSchema = z
  .object({
    lineId: z.string().uuid(),
    kind: z.enum(["window", "mesh_panel"]),
    overrideWidthCm: z.number().int().positive().nullable().optional(),
    overrideHeightCm: z.number().int().positive().nullable().optional(),
    overrideReason: z.string().trim().max(500).nullable().optional(),
  })
  .refine(
    (v) =>
      (v.overrideWidthCm == null && v.overrideHeightCm == null) ||
      (v.overrideReason != null && v.overrideReason.length > 0),
    { message: "An overridden measurement needs a reason", path: ["overrideReason"] },
  );

export const confirmManufactureSchema = z.object({
  orderId: z.string().uuid(),
  lines: z.array(manufactureLineSchema).min(1),
});
```

**Deltas and computed dimensions are deliberately absent from the payload.** The client sends overrides and reasons only; the server recomputes every defaulted value from the allowance table. Never trust arithmetic from a browser.

Create `src/lib/manufacture/preconditions.ts` implementing `checkConfirmPreconditions` as a pure function over the loaded lines, the allowance book and the order status, using `resolveAllowance`, `applyAllowance` and `isManufacturable` from Task 2. Collect every failure reason.

- [ ] **Step 4: Run and watch them pass**

Run: `npx vitest run src/lib/validation/manufacture.test.ts src/lib/manufacture/preconditions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validation/manufacture.ts src/lib/validation/manufacture.test.ts src/lib/manufacture/preconditions.ts src/lib/manufacture/preconditions.test.ts
git commit -m "feat(manufacture): confirm payload schema and preconditions"
```

---

## Task 8: The confirm action

**Files:** Modify `src/lib/actions/manufacture.ts`

- [ ] **Step 1: Write the action**

Add `confirmManufactureMeasurements(input: unknown): Promise<void>`:

1. `await requireRole(["ops", "admin"])` — first statement.
2. `confirmManufactureSchema.parse(input)`.
3. Open **one Kysely transaction** (`db.transaction().execute(async (trx) => { … })`) and inside it:
   - re-read the order and assert `current_status === "deposit_received"`;
   - `loadManufactureLines(orderId)` and `loadAllowanceBook()` **through the transaction**, so the check and the write see the same snapshot;
   - run `checkConfirmPreconditions`; on failure throw `new Error(reasons.join(" "))`;
   - recompute every line server-side with `applyAllowance`, then overlay only the client's overrides (setting `is_overridden` and `override_reason`, and recomputing `width_delta_cm` / `height_delta_cm` as `override − source` so the stored delta always explains the stored result);
   - insert one `manufacture_measurements` row per line with `confirmed_by` set to the acting user;
   - insert one `order_status_events` row at `sent_to_vendor`.
4. `revalidatePath` for `/orders/${orderId}`, `/orders/${orderId}/manufacture` and `/orders`.

Step 3's final insert goes through the normal status-events path, so the existing `validate_status_transition` trigger and the `ose_insert_advance_or_note` RLS policy apply unchanged and the advance is recorded with actor and timestamp like any other.

Wrap the database work so an unexpected failure surfaces via `userMessage(e, "Could not confirm the manufacturing measurements.")`, matching every other action in this codebase. A precondition failure is an authored message and must pass through unchanged — check how `promotions.ts` re-throws its own authored errors before the fallback and follow that pattern.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: clean; test count unchanged from Task 7.

- [ ] **Step 3: Commit**

```bash
git add src/lib/actions/manufacture.ts
git commit -m "feat(manufacture): confirm measurements and advance to sent_to_vendor"
```

---

## Task 9: Locking predicate and action guards

**Files:** Modify `src/lib/status-flow.ts`, `src/lib/status-flow.test.ts`, `src/lib/actions/orders.ts`, `src/lib/actions/mesh-orders.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/status-flow.test.ts`:

```ts
describe("isLocked", () => {
  it("is false before the order reaches the vendor", () => {
    expect(isLocked("order_recorded")).toBe(false);
    expect(isLocked("deposit_received")).toBe(false);
  });

  it("is true from sent_to_vendor onward", () => {
    expect(isLocked("sent_to_vendor")).toBe(true);
    expect(isLocked("sent_logistic")).toBe(true);
    expect(isLocked("shipping_sg")).toBe(true);
    expect(isLocked("delivered_checked")).toBe(true);
    expect(isLocked("fulfilment")).toBe(true);
    expect(isLocked("completed")).toBe(true);
  });
});
```

Add `isLocked` to the import list at the top of that file.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/lib/status-flow.test.ts`
Expected: FAIL — `isLocked` is not exported.

- [ ] **Step 3: Implement**

Add to `src/lib/status-flow.ts`:

```ts
// Once an order has gone to the vendor, its measurements are being cut. Editing
// the consultation behind that is how a customer ends up with curtains for a
// different window. The order reference stays editable (it is paperwork, not a
// manufacturing input) and so do status, notes, photos and amendments — those
// write to other tables.
export function isLocked(s: FulfilmentStatus): boolean {
  return statusIndex(s) >= statusIndex("sent_to_vendor");
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run src/lib/status-flow.test.ts`
Expected: PASS, 8 tests in the file.

- [ ] **Step 5: Guard the actions**

In `updateOrder` and `deleteOrder` (`src/lib/actions/orders.ts`) and `updateMeshOrder` (`src/lib/actions/mesh-orders.ts`), after the existing role guard and Zod parse but **before any write**, read the order's `current_status` and throw when locked:

```ts
  if (isLocked(order.current_status)) {
    throw new Error(
      "This order is locked — it has been sent to the vendor. Ask an admin to amend the manufacturing measurements instead.",
    );
  }
```

Also guard `requoteOrder` in `src/lib/actions/orders.ts`: re-quoting rewrites `price_quoted_cents` on an order the customer has already paid a deposit against and whose goods are in production. Same message.

**Do NOT guard** `setOrderReference`, `advanceOrderStatus`, `revertOrderStatus`, `addStatusNote`, or the photo actions. Each is deliberately still permitted while locked — see §12 of the spec.

Several of these actions already re-read the order; reuse that read rather than adding a second query.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: PASS, 2 more tests than Task 7's total.

- [ ] **Step 7: Commit**

```bash
git add src/lib/status-flow.ts src/lib/status-flow.test.ts src/lib/actions/orders.ts src/lib/actions/mesh-orders.ts
git commit -m "feat(orders): lock an order once it is sent to the vendor"
```

---

## Task 10: Locking at the RLS layer

Defence in depth: `rules/data/rls.md` makes RLS the source of truth and Server Action guards the second line. A missed guard must not be able to write.

**Files:** Create `data/migrations/202608181200_lock_sent_orders.ts`

- [ ] **Step 1: Write the migration**

Redefine the update policies on `orders`, `rooms`, `windows` and `mesh_panels` to add a status predicate. The existing definitions are in `data/migrations/20260530065634_initial.ts` (`orders_update_owner_admin`, `rooms_write_owner_admin`, `windows_write_owner_admin`) and, for mesh panels, in the Phase 11 mesh migration — **find each current definition and reproduce it exactly, adding only the predicate.** Do not guess at a policy body.

Add a SQL helper so the predicate is written once:

```sql
create or replace function public.order_is_locked(p_order_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.orders o
    where o.id = p_order_id
      and o.current_status in ('sent_to_vendor','sent_logistic','shipping_sg',
                               'delivered_checked','fulfilment','completed')
  )
$$;
```

Then each policy gains `and not public.order_is_locked(<the order id in scope>)` — `id` for `orders`, `order_id` for `rooms`, and the room's `order_id` for `windows` and `mesh_panels`.

`down()` restores the original policy bodies verbatim and drops the helper.

> **The `orders` UPDATE policy needs care.** Status advancement writes to
> `orders.current_status` via the `sync_order_current_status` trigger, and
> `setOrderReference` writes `order_reference` — both must keep working on a
> locked order. The trigger runs as the definer of `sync_order_current_status`
> and RLS applies to the invoking role, so **verify empirically** (Step 2)
> that advancing a locked order and editing its reference both still succeed.
> If the blanket predicate breaks either, narrow the policy to the columns that
> must stay frozen rather than weakening the lock — and say so in your report.

- [ ] **Step 2: Apply and prove it, empirically**

Run: `npm run db:migrate`

Then write a temp `.mts` script in the project root that, inside a transaction it **rolls back**, sets a test order to `sent_to_vendor` and confirms, as the `authenticated` role with a real user's claims:

- updating `orders.customer_id` or `discount_bps` is REJECTED
- updating a `rooms` row on that order is REJECTED
- updating a `windows` row on that order is REJECTED
- updating `orders.order_reference` still SUCCEEDS
- inserting an `order_status_events` row still SUCCEEDS and the sync trigger still updates `current_status`
- the same writes on an order at `deposit_received` all SUCCEED

Setting the role and claims requires `set local role authenticated` and `set local request.jwt.claims`. Read how the project's existing RLS is exercised, and if you cannot reproduce an authenticated session faithfully, **say so plainly and report which checks you could not perform** rather than claiming a pass. Roll back — leave no data behind.

- [ ] **Step 3: Commit**

```bash
git add data/migrations/202608181200_lock_sent_orders.ts
git commit -m "feat(orders): enforce the sent-to-vendor lock in RLS"
```

---

## Task 11: The reconciliation view

The heart of the phase. Measured on the left, manufacturing on the right, delta unmissable.

**Files:** Create `src/app/(app)/orders/[orderId]/manufacture/page.tsx` and `src/components/manufacture/reconciliation.tsx`

- [ ] **Step 1: Build the page**

Server Component. `await requireRole(["ops", "admin"])`; anyone else is redirected to `/orders/${orderId}`.

Load the order (id, `display_id`, `order_reference`, `current_status`, customer name), then `loadManufactureLines` and `loadAllowanceBook`. Compute each line's candidate via `applyAllowance` server-side and pass the results down — the client component receives numbers, not the allowance book.

Routing by status:
- before `deposit_received` → redirect to the order with a message
- at `deposit_received` → the editable reconciliation screen
- at `sent_to_vendor` or beyond → read-only, showing the **stored** `manufacture_measurements` rows (not recomputed candidates — the stored row is the truth once confirmed), with an Amend affordance for admins only

If any product line in the order has a null allowance, render the blocking state instead of the grid: name which line, link to `/admin/product/allowances`, and do not offer Confirm.

- [ ] **Step 2: Build the component**

Create `src/components/manufacture/reconciliation.tsx` (`"use client"`).

Grouped by room, then line item, mirroring `src/components/orders/room-summary-card.tsx` so the two screens read the same way.

```
Master Bedroom
┌─────────────────────────────┬─────────────────────────────┐
│ MEASURED                    │ TO MANUFACTURE              │
├─────────────────────────────┼─────────────────────────────┤
│ Window 1                    │                             │
│   Width      300 cm         │   298 cm      −2 cm         │
│   Height     240 cm         │   236 cm      −4 cm         │
└─────────────────────────────┴─────────────────────────────┘
```

Requirements:
- Each adjusted figure shows the result **and** a signed delta chip (`−2 cm`) in a distinct colour. A zero delta shows **no chip** and renders quiet — the chip means "this changed".
- Any manufacturing figure is editable inline. Editing sets that row overridden and reveals a **required** reason field. An overridden row renders visually distinct from a defaulted one: a reader must see at a glance which numbers came from the rule and which came from a person, and why.
- Clearing an override restores the computed default and hides the reason.
- A row whose computed dimension is `≤ 0` renders as an error and blocks Confirm until overridden with a reason.
- On mobile the two columns stack, measured above manufacturing, with the delta chip carrying the comparison rather than horizontal alignment.
- A sticky footer summarises the set (`18 windows · 3 overridden`) and holds the primary action **"Confirm manufacturing measurements"**, disabled while any row is in error.
- Confirming opens a dialog stating plainly what it does: freezes these dimensions for the rest of the order, locks the order from further editing, and moves it to Sent to Vendor. Then calls `confirmManufactureMeasurements` inside `useTransition` with sonner toasts, matching `advance-status-button.tsx`.

- [ ] **Step 3: Add the entry point**

On the order detail page, when `current_status === "deposit_received"` and the viewer is ops or admin, add a button linking to `/orders/${order.id}/manufacture`, labelled **"Review manufacturing measurements"**. From `sent_to_vendor` onward the same link reads **"Manufacturing measurements"** and leads to the read-only view.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run lint && npm test`

Then `npm run dev`, and with a test order at `deposit_received` confirm: the grid renders, deltas show as chips, an override demands a reason, an impossible dimension blocks Confirm, and the mobile layout stacks. **Do not confirm yet** — Task 15 does the full walk.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/orders/[orderId]/manufacture" src/components/manufacture/reconciliation.tsx "src/app/(app)/orders/[orderId]/page.tsx"
git commit -m "feat(manufacture): measured-vs-manufacturing reconciliation view"
```

---

## Task 12: Locking in the UI, and amend

**Files:** Modify `src/app/(app)/orders/[orderId]/edit/page.tsx` and `src/app/(app)/orders/[orderId]/page.tsx`; create `src/components/manufacture/amend-dialog.tsx`; modify `src/lib/actions/manufacture.ts`

- [ ] **Step 1: Lock the edit route**

In `src/app/(app)/orders/[orderId]/edit/page.tsx`, after loading the order, `redirect(\`/orders/${orderId}\`)` when `isLocked(order.current_status)`.

- [ ] **Step 2: Lock the detail-page affordances**

On the order detail page, when locked, replace the **Edit** and **Delete** buttons with a short lock notice naming the status ("Locked — sent to the vendor on 18 Aug 2026"). The re-quote banner must also not offer its button when locked.

- [ ] **Step 3: Add the amend action**

Add `amendManufactureMeasurements(input: unknown)` to `src/lib/actions/manufacture.ts`:

1. `await requireRole(["admin"])`.
2. Validate with a schema requiring `orderId`, at least one changed line, and a non-empty `reason`.
3. In one transaction: assert `current_status === "sent_to_vendor"`; update the affected `manufacture_measurements` rows; insert an `order_status_events` row **at the current status** with note `[MEASUREMENTS AMENDED] <reason>`.

The order **stays** at `sent_to_vendor` — an amendment corrects what the vendor is building, it is not a step backwards. The same-status insert is already permitted by the transition validator and the RLS policy, so the amendment lands in the timeline the whole team reads.

`source_*` values are **not** re-snapshotted: they record what the set was originally derived from, and the order is locked so they cannot have changed.

- [ ] **Step 4: Build the amend dialog**

`src/components/manufacture/amend-dialog.tsx` — admin-only, reachable from the read-only reconciliation view. Lets an admin change manufacturing dimensions, demands a reason, and calls the action. Follow the house dialog pattern in `advance-status-button.tsx`.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npm run lint && npm test`

- [ ] **Step 6: Commit**

```bash
git add -A src/
git commit -m "feat(orders): lock the order in the UI and allow admin amendments"
```

---

## Task 13: Cost off manufacturing width — curtains and blinds

**The riskiest change in the phase.** `calculator.ts` derives cost and sale from a single width, and every quote in the app flows through it. The customer's price must not move.

**Files:** Modify `src/lib/pricing/calculator.ts` and `src/lib/pricing/calculator.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/pricing/calculator.test.ts` a `describe("costWidthCm")` covering:

- a window with `costWidthCm` set produces a **lower cost** than the same window without it, and an **identical sale**
- a window with `costWidthCm` absent produces results byte-identical to today (snapshot the existing expected values from a neighbouring test rather than inventing new ones)
- `costWidthCm` applies to the day leg, the night leg **and** the blind leg
- per-metre add-ons (`sFold`, `slimTracks`) use the cost width on the cost side and the measured width on the sale side
- a **per-unit** add-on is unaffected by either width
- a combo override still fixes the sale price and leaves the cost side free to use `costWidthCm`
- the style multiplier still applies to cost only

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/lib/pricing/calculator.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add to `CalcWindow`:

```ts
  /** Manufacturing width, when a set has been confirmed. Cost only — the sale
   *  side always uses widthCm, which is what the customer was quoted on. */
  costWidthCm?: number | null;
```

Change `curtainLeg`, `blindLeg` and `addonLeg` to take both widths, using `costWidthCm ?? widthCm` for `costRmbCents` and `widthCm` for `saleSgdCents`. Every other rule is unchanged: the style multiplier on cost only, combo overrides on sale only, per-unit add-ons ignoring width, the zero-guards on unmeasured windows.

- [ ] **Step 4: Run and watch them pass**

Run: `npx vitest run src/lib/pricing/`
Expected: PASS — **including every pre-existing pricing test unchanged.** If an existing test changed its expected value, the sale side has moved and the implementation is wrong. Stop and report.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pricing/calculator.ts src/lib/pricing/calculator.test.ts
git commit -m "feat(pricing): cost curtains and blinds off the manufacturing width"
```

---

## Task 14: Cost off manufacturing area — mesh, and wiring

**Files:** Modify `src/lib/pricing/mesh-calculator.ts` + `.test.ts`, `src/lib/pricing/order-quote.ts`, `src/lib/pricing/quote-staleness.test.ts`

- [ ] **Step 1: Write the failing tests**

Mesh is priced on area, and `panelQuote` deliberately applies the minimum billable area **to both sides** so "a minimum never flatters the margin" (see the comment in `panelQuote`). Append tests covering:

- a panel with `costWidthCm`/`costHeightCm` costs less and sells the same
- the **minimum-area floor is honoured independently on each side** — a panel under the floor on manufacturing dimensions but over it on measured dimensions floors the cost side and not the sale side
- colour and double-draw surcharges, which are flat per-panel charges, are unaffected
- **the system band resolves from the MEASURED width, not the manufacturing width** — a panel whose measured width sits just above a band boundary keeps its measured band even when the manufacturing width falls below it

That last one is a deliberate decision, flagged in spec §11.2: the band picks a physical track system for the opening, which is a survey decision about the window, not a property of the fabric being cut.

- [ ] **Step 2: Run and watch them fail, then implement**

Add `costWidthCm` / `costHeightCm` to `MeshPanel`. In `panelQuote`, compute `panelBillableArea` **twice** — once on measured dimensions for the sale side, once on manufacturing dimensions for the cost side — and keep `resolveMeshSystem` reading the measured width.

Run `npx vitest run src/lib/pricing/` and confirm every pre-existing mesh test still passes unchanged.

- [ ] **Step 3: Wire the quote**

In `src/lib/pricing/order-quote.ts`, left-join `manufacture_measurements` on `window_id` / `mesh_panel_id` and populate `costWidthCm` (and `costHeightCm` for mesh) when a row exists. With no confirmed set the fields are absent and behaviour is byte-identical to today.

- [ ] **Step 4: Guard against the staleness regression**

Add a test to `src/lib/pricing/quote-staleness.test.ts` proving that a confirmed manufacturing set does **not** raise the stale-quote banner. Staleness compares the locked sale price against a recomputed sale price; since none of this changes the sale side, the banner must stay quiet. This is the most likely unintended consequence of the whole phase — the test is the point of it.

- [ ] **Step 5: Verify and commit**

Run: `npx tsc --noEmit && npm test && npm run lint`

```bash
git add src/lib/pricing/
git commit -m "feat(pricing): cost mesh off manufacturing area and wire the quote"
```

---

## Task 15: End-to-end verification

- [ ] **Step 1: Build**

Run: `npm run build` — expect a clean production build.

- [ ] **Step 2: Walk it in the app**

`npm run dev` (note: port 3000 may be taken by another project — check the startup log for the actual port). As an admin:

1. `/admin/product/allowances` — Curtains reads −2 / −4; Blinds and Mesh read "Not set" with the warning. Fill in Blinds and Mesh; reload; values persisted.
2. Take a test order from `order_recorded` → **Record deposit received**.
3. **Review manufacturing measurements** — the grid renders grouped by room, each width shows `300 → 298 (−2)` and each height `240 → 236 (−4)`.
4. Override one window's width, confirm the reason is required, and that a blank reason blocks the save.
5. Confirm → the order advances to **Sent to Vendor** and the timeline records who and when.
6. The order is now **locked**: Edit and Delete are replaced by the lock notice, `/orders/<id>/edit` redirects, and the re-quote button is gone.
7. Still permitted while locked: advance status, add a note, and edit the **order reference**.
8. The reconciliation view is now read-only and shows the **stored** rows including the override and its reason. Amend one as admin; the order stays at Sent to Vendor and a `[MEASUREMENTS AMENDED]` note appears in the timeline.
9. Check the COGS breakdown moved and the **customer's quoted price did not**, and that the stale-quote banner did not appear.

- [ ] **Step 3: Restore the test data**

The walk mutates a live order. Afterwards, restore it: delete the `manufacture_measurements` rows and the `order_status_events` rows this walk created, and reset `current_status`. Report exactly what you changed and what you restored.

- [ ] **Step 4: Update the spec**

Change the status line of `docs/specs/phase-13-order-flow-and-manufacture.md` to record 13B as implemented, leaving 13C blocked on a vendor Excel sample.

- [ ] **Step 5: Commit**

```bash
git add docs/specs/phase-13-order-flow-and-manufacture.md
git commit -m "docs(specs): mark phase 13B implemented"
```

---

## Out of scope

- Vendor PDF generation (13C) — blocked on a sample vendor Excel.
- Per-vendor order numbering.
- Any change to the customer-facing quoted price as a result of manufacturing dimensions.
- Per-series or per-blind-type allowances. Product line only.
