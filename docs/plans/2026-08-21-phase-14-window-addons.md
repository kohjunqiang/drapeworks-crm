# Phase 14 — Window Add-ons & Blinds-Only Toilets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two hard-coded window add-on columns with an admin-maintained add-on list joined to windows, wire blinds up to add-ons for the first time, and retire the toilet-curtain window variant.

**Architecture:** `pricing_addons` gains scoping (`applies_to`) and auto-apply rules (`auto_rule`, `auto_width_over_cm`). A `window_addons` join table replaces `windows.add_s_fold` / `add_slim_tracks`. One pure function, `resolveWindowAddons`, decides which add-ons a window offers and which are ticked; it runs in the form and in every Server Action write path, and never at quote-read time — the persisted join rows are the truth for a saved order. The `toilet` window variant and `windows.curtain_type_id` are dropped, so a toilet room's windows are blinds.

**Tech Stack:** Next.js 15 App Router (RSC), TypeScript strict, Kysely migrations against Postgres/Supabase, Zod validation, React Hook Form, Vitest, Tailwind + shadcn/ui.

**Spec:** `docs/specs/phase-14-window-addons.md` — read it before starting. This plan implements it; where they disagree, the spec is right and the plan has a bug.

---

## Before you start

Read these, in order:

1. `docs/specs/phase-14-window-addons.md` — the whole thing. It explains *why* each rule exists; this plan only says *what to type*.
2. `rules/data/migrations.md`, `rules/code/server-actions.md`, `rules/code/forms.md`.
3. `CLAUDE.md` — in particular: money is integer cents, no hard deletes, every Server Action starts with `requireRole`/`requireSession`, catalogue labels are stored verbatim.

Run the test suite once now so you know what "green" looks like before you touch anything:

```bash
npm run test
```

Expected: all tests pass (457 at time of writing).

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `data/migrations/202608212000_pricing_addon_rules.ts` | `applies_to` / `auto_rule` / `auto_width_over_cm` + enums + constraint + seed |
| `data/migrations/202608212100_window_addons.ts` | `window_addons` table, backfill, drop the two boolean columns |
| `data/migrations/202608212200_toilets_are_blinds.ts` | rewrite `validate_window_shape()`, drop `windows.curtain_type_id` |
| `src/lib/orders/window-addons.ts` | `AddonRule`, `ResolvedAddon`, `resolveWindowAddons`, `toCalcAddons` — pure, no IO |
| `src/lib/orders/window-addons.test.ts` | resolver unit tests |
| `src/lib/db/window-addons.ts` | `server-only` loaders: persisted add-on ids and priced add-on rows, by window |
| `src/components/orders/consultation-form/addon-checkboxes.tsx` | the shared add-ons row, used by both window branches |

**Modified:** `src/lib/pricing/calculator.ts`, `calculator.test.ts`, `order-quote.ts`, `stale-flags.ts`, `stale-flags.test.ts`, `quote-staleness.test.ts`, `src/lib/validation/order.ts`, `order.test.ts`, `src/lib/orders/window-values.ts`, `window-values.test.ts`, `src/lib/actions/orders.ts`, `src/lib/actions/pricing-settings.ts`, `src/lib/validation/pricing-settings.ts`, `src/lib/db/pricing-settings.ts`, `src/components/pricing/addons-table.tsx`, `src/components/orders/consultation-form/{index,room-card,window-fields,live-quote}.tsx`, `src/components/orders/room-summary-card.tsx`, `src/app/(app)/orders/[orderId]/{page,edit/page}.tsx`, `src/lib/po/{load,track-order-load}.ts`, `src/lib/manufacture/load.ts`, `src/lib/validation/procurement.ts`.

**Rule of thumb for the whole plan:** the resolver decides, the calculator prices, the actions persist. If you find yourself filtering add-ons inside a SQL query, stop — that is the resolver's job and doing it in SQL is the bug §4 of the spec exists to prevent.

---

## Stage A — Database

### Task 1: Migration — add-on rules

**Files:**
- Create: `data/migrations/202608212000_pricing_addon_rules.ts`

- [ ] **Step 1: Write the migration**

```ts
import { sql, type Kysely } from "kysely";

// Phase 14 — an add-on stops being a hard-coded column and becomes a row an
// admin maintains. Three columns carry what the code used to know by name:
// which covering offers it, and whether it is ticked by hand or applied by a
// rule.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create type pricing_addon_scope as enum ('curtain', 'blind', 'both')`.execute(
    db,
  );
  await sql`create type pricing_addon_auto_rule as enum ('manual', 'always', 'width_over')`.execute(
    db,
  );

  // 'curtain' / 'manual' are chosen so the two live add-ons (s_fold,
  // slim_tracks) land correctly with no update, and so a row added by hand
  // later fails SAFE: visible on curtains, never silently auto-charged.
  await db.schema
    .alterTable("pricing_addons")
    .addColumn("applies_to", sql`pricing_addon_scope`, (c) =>
      c.notNull().defaultTo("curtain"),
    )
    .addColumn("auto_rule", sql`pricing_addon_auto_rule`, (c) =>
      c.notNull().defaultTo("manual"),
    )
    .addColumn("auto_width_over_cm", "integer")
    .execute();

  // The threshold and the rule cannot disagree. Without this, a 'width_over'
  // row with a null threshold is a silent no-op that looks configured.
  await sql`
    alter table public.pricing_addons
      add constraint pricing_addons_auto_width_agrees
        check (
          (auto_rule = 'width_over'
             and auto_width_over_cm is not null and auto_width_over_cm > 0)
          or (auto_rule <> 'width_over' and auto_width_over_cm is null)
        )
  `.execute(db);

  // Blackout is sold on both product lines.
  await sql`
    update public.pricing_addons set applies_to = 'blind' where key = 'blinds_surcharge'
  `.execute(db);
  await sql`
    update public.pricing_addons set applies_to = 'both' where key = 'blackout'
  `.execute(db);

  // blinds_surcharge deliberately keeps auto_rule = 'manual'. Its live values
  // are 0/0 on a basis nobody chose, contradicting the Phase-9 seed. Wiring an
  // unpriced row as always-applied is a landmine: the day someone prices it,
  // every subsequent blind re-prices while already-quoted ones do not. It also
  // charges nothing, so the resolver keeps it off the form until it is priced.

  // Extra shipping: a blind over 2m wide ships in a non-standard carton.
  // Unpriced on purpose — we are not inventing a figure. The admin screen
  // flags it, and the resolver hides it until it has one.
  await sql`
    insert into public.pricing_addons
      (key, label, cost_rmb_cents, sale_sgd_cents, basis,
       applies_to, auto_rule, auto_width_over_cm)
    values
      ('extra_shipping', 'Extra shipping', null, null, 'per_unit',
       'blind', 'width_over', 200)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`delete from public.pricing_addons where key = 'extra_shipping'`.execute(
    db,
  );
  await sql`
    alter table public.pricing_addons drop constraint pricing_addons_auto_width_agrees
  `.execute(db);
  await db.schema
    .alterTable("pricing_addons")
    .dropColumn("auto_width_over_cm")
    .dropColumn("auto_rule")
    .dropColumn("applies_to")
    .execute();
  await sql`drop type pricing_addon_auto_rule`.execute(db);
  await sql`drop type pricing_addon_scope`.execute(db);
}
```

- [ ] **Step 2: Commit** (do not run it yet — Task 4 runs all three together)

```bash
git add data/migrations/202608212000_pricing_addon_rules.ts
git commit -m "feat(db): give add-ons a scope and an auto-apply rule"
```

---

### Task 2: Migration — `window_addons`

**Files:**
- Create: `data/migrations/202608212100_window_addons.ts`

- [ ] **Step 1: Write the migration**

```ts
import { sql, type Kysely } from "kysely";

// Phase 14 — which add-ons a window carries becomes rows, not columns. The two
// boolean columns are backfilled and dropped: leaving them would be two
// sources of truth for the same fact, which is how `blackout` sat in the
// admin screen for a phase and a half charging nobody.

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("window_addons")
    .addColumn("window_id", "uuid", (c) =>
      c.notNull().references("windows.id").onDelete("cascade"),
    )
    // restrict, not cascade: add-ons are archived, never deleted, and an
    // add-on in use must not be removable out from under a quoted order.
    .addColumn("addon_id", "uuid", (c) =>
      c.notNull().references("pricing_addons.id").onDelete("restrict"),
    )
    .addColumn("created_at", "timestamptz", (c) =>
      c.notNull().defaultTo(sql`now()`),
    )
    .addPrimaryKeyConstraint("window_addons_pkey", ["window_id", "addon_id"])
    .execute();

  await sql`create index window_addons_addon_id_idx on public.window_addons (addon_id)`.execute(
    db,
  );

  // Affects 0 rows today. Written correctly anyway — this migration may run
  // against a database that has moved on.
  await sql`
    insert into public.window_addons (window_id, addon_id)
    select w.id, a.id from public.windows w
      join public.pricing_addons a on a.key = 's_fold'
     where w.add_s_fold
    union all
    select w.id, a.id from public.windows w
      join public.pricing_addons a on a.key = 'slim_tracks'
     where w.add_slim_tracks
  `.execute(db);

  await db.schema
    .alterTable("windows")
    .dropColumn("add_s_fold")
    .dropColumn("add_slim_tracks")
    .execute();

  // RLS mirrors the windows policies (202608181200). Per rules/data/rls.md the
  // policy is written but not relied on — the app connects as table owner, so
  // the Server Actions are the enforcement surface.
  await sql`alter table public.window_addons enable row level security`.execute(
    db,
  );
  await sql`
    create policy "window_addons_select_authenticated"
      on public.window_addons for select to authenticated using (true)
  `.execute(db);
  await sql`
    create policy "window_addons_write_owner_admin"
      on public.window_addons for all to authenticated
      using (
        exists (
          select 1 from public.windows w
          join public.rooms rm on rm.id = w.room_id
          join public.orders o on o.id = rm.order_id
          where w.id = window_addons.window_id
            and (o.consultant_id = auth.uid() or public.is_admin())
            and not public.order_is_locked(o.id)
        )
      )
      with check (
        exists (
          select 1 from public.windows w
          join public.rooms rm on rm.id = w.room_id
          join public.orders o on o.id = rm.order_id
          where w.id = window_addons.window_id
            and (o.consultant_id = auth.uid() or public.is_admin())
            and not public.order_is_locked(o.id)
        )
      )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("windows")
    .addColumn("add_s_fold", "boolean", (c) => c.notNull().defaultTo(false))
    .addColumn("add_slim_tracks", "boolean", (c) => c.notNull().defaultTo(false))
    .execute();

  await sql`
    update public.windows w set add_s_fold = true
      from public.window_addons wa
      join public.pricing_addons a on a.id = wa.addon_id
     where wa.window_id = w.id and a.key = 's_fold'
  `.execute(db);
  await sql`
    update public.windows w set add_slim_tracks = true
      from public.window_addons wa
      join public.pricing_addons a on a.id = wa.addon_id
     where wa.window_id = w.id and a.key = 'slim_tracks'
  `.execute(db);

  await db.schema.dropTable("window_addons").execute();
}
```

- [ ] **Step 2: Commit**

```bash
git add data/migrations/202608212100_window_addons.ts
git commit -m "feat(db): make a window's add-ons rows instead of columns"
```

---

### Task 3: Migration — toilets are blinds

**Files:**
- Create: `data/migrations/202608212200_toilets_are_blinds.ts`

**Note the ordering inside `up()`:** the trigger is rewritten *before* the column is dropped, matching the convention `20260817090000`'s `down()` calls out. `down()` reverses it — column back first, then the old body.

- [ ] **Step 1: Write the migration**

```ts
import { sql, type Kysely } from "kysely";

// Phase 14 — a toilet window is a blind. The single-curtain variant modelled a
// product we no longer sell, and keeping it would force a fourth add-on scope
// existing only to describe it. 0 rows use curtain_type_id (audited
// 2026-08-21), so this strands nothing.

export async function up(db: Kysely<unknown>): Promise<void> {
  // Rewritten BEFORE the column goes: a body naming a dropped column is not
  // something to leave lying around mid-migration.
  await sql`
    create or replace function public.validate_window_shape() returns trigger
    language plpgsql as $$
    declare
      v_room_type public.room_type;
    begin
      -- A blind carries no curtain. Valid in every room, toilets included.
      if new.blind_type_id is not null then
        if new.day_curtain_type_id is not null
           or new.night_curtain_type_id is not null then
          raise exception 'blind windows must not have a curtain type';
        end if;
        return new;
      end if;

      -- No blind picked: a curtain window, or an empty one being filled in.
      -- Note draw is now permitted here: on a half-filled toilet window it is
      -- the blind's control side, and a draft must survive the round trip.
      select type into v_room_type from public.rooms where id = new.room_id;
      if v_room_type in ('Master Toilet', 'Common Toilet')
         and (new.day_curtain_type_id is not null
              or new.night_curtain_type_id is not null) then
        raise exception 'toilet windows take a blind, not a curtain';
      end if;
      return new;
    end
    $$
  `.execute(db);

  await db.schema.alterTable("windows").dropColumn("curtain_type_id").execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("windows")
    .addColumn("curtain_type_id", "uuid", (c) => c.references("curtain_types.id"))
    .execute();

  // Restore the body 20260817090000 left in place.
  await sql`
    create or replace function public.validate_window_shape() returns trigger
    language plpgsql as $$
    declare
      v_room_type public.room_type;
      v_is_toilet boolean;
    begin
      if new.blind_type_id is not null then
        if new.day_curtain_type_id is not null
           or new.night_curtain_type_id is not null
           or new.curtain_type_id is not null then
          raise exception 'blind windows must not have any curtain type';
        end if;
        return new;
      end if;

      select type into v_room_type from public.rooms where id = new.room_id;
      v_is_toilet := v_room_type in ('Master Toilet', 'Common Toilet');
      if v_is_toilet then
        if new.draw is not null
           or new.day_curtain_type_id is not null
           or new.night_curtain_type_id is not null then
          raise exception 'toilet windows must not have day/night curtain or draw';
        end if;
      else
        if new.curtain_type_id is not null then
          raise exception 'non-toilet windows must not have a single curtain (use day/night)';
        end if;
      end if;
      return new;
    end
    $$
  `.execute(db);
}
```

- [ ] **Step 2: Commit**

```bash
git add data/migrations/202608212200_toilets_are_blinds.ts
git commit -m "feat(db): a toilet window is a blind"
```

---

### Task 4: Apply migrations and regenerate types

**Files:**
- Modify: `src/lib/db/schema.ts` (generated — do not hand-edit)

- [ ] **Step 1: Re-audit before running**

The migrations assume 0 toilet-curtain windows. Confirm that is still true:

```bash
NODE_PATH=$PWD/node_modules npx tsx -e "
import 'dotenv/config';
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, ssl: { rejectUnauthorized: false } });
(async () => {
  const r = await pool.query('select count(*)::int as n from windows where curtain_type_id is not null');
  console.log('toilet-curtain windows:', r.rows[0].n);
  await pool.end();
})();
"
```

Expected: `toilet-curtain windows: 0`.

**If this is not 0, STOP** and raise it — the spec's §9 says re-audit before running, and a non-zero count means live data would be dropped.

- [ ] **Step 2: Apply**

```bash
npm run db:migrate
```

Expected: three migrations reported as executed, no errors.

- [ ] **Step 3: Regenerate types**

```bash
npm run db:codegen
```

- [ ] **Step 4: Verify the constraint and the backfill by hand**

There is no migration-test harness in this project, so check the invariants directly rather than assuming:

```bash
NODE_PATH=$PWD/node_modules npx tsx -e "
import 'dotenv/config';
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, ssl: { rejectUnauthorized: false } });
(async () => {
  const bad = async (sql: string, what: string) => {
    try { await pool.query(sql); console.log('FAIL — accepted:', what); }
    catch { console.log('ok — rejected:', what); }
  };
  await bad(\"update pricing_addons set auto_rule='width_over', auto_width_over_cm=null where key='s_fold'\", 'width_over with no threshold');
  await bad(\"update pricing_addons set auto_rule='manual', auto_width_over_cm=200 where key='s_fold'\", 'manual with a threshold');
  const r = await pool.query(\"select key, applies_to, auto_rule, auto_width_over_cm from pricing_addons order by key\");
  console.table(r.rows);
  await pool.end();
})();
"
```

Expected: both `ok — rejected`, and the table shows `extra_shipping` as `blind` / `width_over` / `200`, `blinds_surcharge` as `blind` / `manual`, `blackout` as `both` / `manual`.

- [ ] **Step 5: Confirm the schema moved**

```bash
grep -n "add_s_fold\|curtain_type_id" src/lib/db/schema.ts | grep -v "day_curtain_type_id\|night_curtain_type_id"
grep -n "interface WindowAddons" -A 5 src/lib/db/schema.ts
```

Expected: the first prints nothing; the second shows the new table.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/schema.ts
git commit -m "chore(db): regenerate schema after the add-on migrations"
```

At this point `npm run build` will fail with many errors. That is expected and is the map for Stages B–H.

---

## Stage B — The resolver

### Task 5: `resolveWindowAddons`

**Files:**
- Create: `src/lib/orders/window-addons.ts`
- Test: `src/lib/orders/window-addons.test.ts`

This is the heart of the phase. It is pure — no IO, no React, no Kysely — so it can be unit-tested exhaustively and shared by the form and the server.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";

import {
  resolveWindowAddons,
  toCalcAddons,
  type AddonRule,
} from "./window-addons";

const rule = (over: Partial<AddonRule> = {}): AddonRule => ({
  id: "00000000-0000-0000-0000-000000000001",
  key: "s_fold",
  label: "S-Fold",
  costRmbCents: 1100,
  saleSgdCents: 8000,
  basis: "per_metre",
  appliesTo: "curtain",
  autoRule: "manual",
  autoWidthOverCm: null,
  isActive: true,
  ...over,
});

const id = (n: number) => `00000000-0000-0000-0000-00000000000${n}`;

describe("resolveWindowAddons — scope", () => {
  it("hides a curtain add-on from a blind", () => {
    const out = resolveWindowAddons("blind", 150, [], [], [rule()]);
    expect(out).toEqual([]);
  });

  it("shows a 'both' add-on on each covering", () => {
    const both = rule({ id: id(2), key: "blackout", appliesTo: "both" });
    expect(resolveWindowAddons("blind", 150, [], [], [both])).toHaveLength(1);
    expect(resolveWindowAddons("curtain", 150, [], [], [both])).toHaveLength(1);
  });

  it("drops a persisted curtain add-on when the window became a blind", () => {
    // Scope runs FIRST, so survival cannot resurrect an out-of-scope add-on.
    const out = resolveWindowAddons("blind", 150, [id(1)], [id(1)], [rule()]);
    expect(out).toEqual([]);
  });
});

describe("resolveWindowAddons — nothing to offer", () => {
  it("hides an inactive add-on", () => {
    const out = resolveWindowAddons(
      "curtain",
      150,
      [],
      [],
      [rule({ isActive: false })],
    );
    expect(out).toEqual([]);
  });

  it("hides an add-on that charges nothing", () => {
    const out = resolveWindowAddons(
      "curtain",
      150,
      [],
      [],
      [rule({ costRmbCents: 0, saleSgdCents: 0 })],
    );
    expect(out).toEqual([]);
  });

  it("hides an unpriced width_over add-on however wide the window", () => {
    const out = resolveWindowAddons(
      "blind",
      300,
      [],
      [],
      [
        rule({
          key: "extra_shipping",
          appliesTo: "blind",
          autoRule: "width_over",
          autoWidthOverCm: 200,
          costRmbCents: null,
          saleSgdCents: null,
        }),
      ],
    );
    expect(out).toEqual([]);
  });

  it("keeps a cost-only add-on — it still moves COGS", () => {
    const out = resolveWindowAddons(
      "curtain",
      150,
      [],
      [],
      [rule({ costRmbCents: 2700, saleSgdCents: null })],
    );
    expect(out).toHaveLength(1);
  });

  it("keeps an inactive add-on the window already carries", () => {
    const out = resolveWindowAddons(
      "curtain",
      150,
      [id(1)],
      [id(1)],
      [rule({ isActive: false })],
    );
    expect(out).toHaveLength(1);
    expect(out[0].selected).toBe(true);
    expect(out[0].locked).toBe(false); // clearable, just not re-tickable
  });

  it("does not let selectedIds alone grant survival", () => {
    // The create-path forgery: a payload claiming an archived add-on was
    // already on a brand-new window. Only persistedIds may say that.
    const out = resolveWindowAddons(
      "curtain",
      150,
      [id(1)],
      [],
      [rule({ isActive: false })],
    );
    expect(out).toEqual([]);
  });
});

describe("resolveWindowAddons — auto rules", () => {
  const shipping = rule({
    id: id(3),
    key: "extra_shipping",
    label: "Extra shipping",
    appliesTo: "blind",
    basis: "per_unit",
    autoRule: "width_over",
    autoWidthOverCm: 200,
    costRmbCents: null,
    saleSgdCents: 13000,
  });

  it("leaves 199 unlocked", () => {
    const [a] = resolveWindowAddons("blind", 199, [], [], [shipping]);
    expect(a).toMatchObject({ selected: false, locked: false });
  });

  it("leaves exactly 200 unlocked — the threshold must be exceeded", () => {
    const [a] = resolveWindowAddons("blind", 200, [], [], [shipping]);
    expect(a).toMatchObject({ selected: false, locked: false });
  });

  it("locks 201", () => {
    const [a] = resolveWindowAddons("blind", 201, [], [], [shipping]);
    expect(a).toMatchObject({ selected: true, locked: true });
  });

  it("lets a consultant tick it below the threshold", () => {
    const [a] = resolveWindowAddons("blind", 150, [id(3)], [], [shipping]);
    expect(a).toMatchObject({ selected: true, locked: false });
  });

  it("never auto-locks an unmeasured window", () => {
    const [a] = resolveWindowAddons("blind", null, [], [], [shipping]);
    expect(a).toMatchObject({ selected: false, locked: false });
  });

  it("applies an 'always' add-on whatever the width", () => {
    const always = rule({
      id: id(4),
      key: "blinds_surcharge",
      appliesTo: "blind",
      autoRule: "always",
    });
    const [a] = resolveWindowAddons("blind", null, [], [], [always]);
    expect(a).toMatchObject({ selected: true, locked: true });
  });
});

describe("resolveWindowAddons — ordering", () => {
  it("puts active before archived, then sorts by label", () => {
    const rows = [
      rule({ id: id(5), key: "zebra", label: "Zebra" }),
      rule({ id: id(6), key: "alpha", label: "Alpha" }),
      rule({ id: id(7), key: "gone", label: "Archived", isActive: false }),
    ];
    const out = resolveWindowAddons("curtain", 150, [id(7)], [id(7)], rows);
    expect(out.map((a) => a.label)).toEqual(["Alpha", "Zebra", "Archived"]);
  });
});

describe("toCalcAddons", () => {
  it("passes only the selected ones through, as calculator input", () => {
    const rows = [
      rule({ id: id(1), label: "S-Fold" }),
      rule({ id: id(2), key: "blackout", label: "Blackout" }),
    ];
    const resolved = resolveWindowAddons("curtain", 150, [id(2)], [], rows);
    expect(toCalcAddons(resolved)).toEqual([
      {
        label: "Blackout",
        costRmbCents: 1100,
        saleSgdCents: 8000,
        basis: "per_metre",
      },
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- src/lib/orders/window-addons.test.ts`
Expected: FAIL — `Failed to resolve import "./window-addons"`.

- [ ] **Step 3: Write the implementation**

```ts
// Which add-ons a window offers, and which of them are ticked.
//
// Pure by design: the consultation form and every Server Action write path run
// the SAME function, so the live quote and the saved quote cannot disagree
// about what a window carries. It deliberately does NOT run at quote-read time
// — for a saved order the persisted window_addons rows are the truth, because a
// quote must reproduce what was agreed rather than what today's rules decide.

export type AddonBasis = "per_metre" | "per_unit";

export type AddonRule = {
  id: string;
  key: string;
  label: string;
  costRmbCents: number | null;
  saleSgdCents: number | null;
  basis: AddonBasis;
  appliesTo: "curtain" | "blind" | "both";
  autoRule: "manual" | "always" | "width_over";
  autoWidthOverCm: number | null;
  isActive: boolean;
};

export type ResolvedAddon = AddonRule & {
  /** Ticked, whether by the consultant or by the rule. */
  selected: boolean;
  /** The rule decided it; the consultant cannot untick it. */
  locked: boolean;
};

/** What the calculator needs — a resolved add-on stripped of its rules. */
export type CalcAddon = {
  label: string;
  costRmbCents: number | null;
  saleSgdCents: number | null;
  basis: AddonBasis;
};

/**
 * An add-on with no cost AND no sale charges nothing. Offering it is the same
 * mistake as listing a curtain series with no price: a control that looks like
 * it does something and doesn't. Cost-only is a real add-on — it moves COGS —
 * so both sides must be empty to count as nothing.
 */
function chargesNothing(a: AddonRule): boolean {
  return !a.costRmbCents && !a.saleSgdCents;
}

export function resolveWindowAddons(
  covering: "curtain" | "blind",
  widthCm: number | null,
  /** What is ticked right now. On the server, the submitted set. */
  selectedIds: readonly string[],
  /**
   * What window_addons already holds for this window. Empty on both create
   * paths. This — never selectedIds — is what grants the survival exception,
   * so a payload cannot claim an archived add-on "was already there".
   */
  persistedIds: readonly string[],
  /** Every pricing_addons row, unfiltered. Filtering is this function's job. */
  catalogue: readonly AddonRule[],
): ResolvedAddon[] {
  const ticked = new Set(selectedIds);
  const persisted = new Set(persistedIds);

  const offered = catalogue.filter((a) => {
    // 1. Scope runs first, so nothing below can resurrect an add-on that
    //    belongs to the other covering.
    if (a.appliesTo !== "both" && a.appliesTo !== covering) return false;
    // 2. Don't offer what can't be quoted — unless the window already has it,
    //    in which case dropping it would silently delete a real charge on the
    //    next save.
    if (persisted.has(a.id)) return true;
    return a.isActive && !chargesNothing(a);
  });

  return offered
    .map((a): ResolvedAddon => {
      if (a.autoRule === "always") return { ...a, selected: true, locked: true };
      if (
        a.autoRule === "width_over" &&
        a.autoWidthOverCm != null &&
        widthCm != null &&
        widthCm > a.autoWidthOverCm
      ) {
        return { ...a, selected: true, locked: true };
      }
      // Manual, and any width_over that did not trigger. A persisted-but-
      // retired add-on lands here too: clearable, and once cleared the filter
      // above drops it for good.
      return { ...a, selected: ticked.has(a.id), locked: false };
    })
    .sort(
      (x, y) =>
        Number(y.isActive) - Number(x.isActive) ||
        x.label.localeCompare(y.label),
    );
}

/** The ticked add-ons, as calculator input. */
export function toCalcAddons(resolved: readonly ResolvedAddon[]): CalcAddon[] {
  return resolved
    .filter((a) => a.selected)
    .map((a) => ({
      label: a.label,
      costRmbCents: a.costRmbCents,
      saleSgdCents: a.saleSgdCents,
      basis: a.basis,
    }));
}

/** The ticked add-ons' ids, for persistence. */
export function selectedAddonIds(resolved: readonly ResolvedAddon[]): string[] {
  return resolved.filter((a) => a.selected).map((a) => a.id);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- src/lib/orders/window-addons.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/orders/window-addons.ts src/lib/orders/window-addons.test.ts
git commit -m "feat(orders): one function decides which add-ons a window offers"
```

---

## Stage C — Calculator

### Task 6: Price a window's add-ons from a list

**Files:**
- Modify: `src/lib/pricing/calculator.ts` (`:146-152` `CalcAddonBook`, `:153-176` `CalcWindow`, `:384` `windowQuote`, `:418-446` blind branch, `:487-501` the two add-on blocks, `:684` `computeQuote`)
- Test: `src/lib/pricing/calculator.test.ts`

**Signature change, so you are not surprised mid-task:** `book` is the *second positional parameter* of both `windowQuote` and `computeQuote`. Removing it touches `live-quote.tsx:111`, `order-quote.ts:579`, `stale-flags.ts:60`, `quote-staleness.test.ts:117` and ~25 sites in `calculator.test.ts` via a shared `BOOK` constant (73 references). The build catches every one; later tasks fix the non-test callers.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/pricing/calculator.test.ts`. Reuse the file's existing `ASSUMPTIONS` constant and window helpers; these show the new shape.

```ts
describe("add-ons", () => {
  const perMetre = {
    label: "Blackout",
    costRmbCents: 2700,
    saleSgdCents: 5000,
    basis: "per_metre" as const,
  };
  const perUnit = {
    label: "Extra shipping",
    costRmbCents: null,
    saleSgdCents: 13000,
    basis: "per_unit" as const,
  };

  it("charges a blind's per-metre add-on", () => {
    const q = windowQuote(
      {
        widthCm: 200,
        blindPrice: { costRmbCents: 1000, saleSgdCents: 4000, label: "Zen" },
        addons: [perMetre],
      },
      ASSUMPTIONS,
    );
    // 2m × ¥27 = ¥54 on top of the blind's 2m × ¥10 = ¥20
    expect(q.costRmbCents).toBe(2000 + 5400);
    expect(q.saleSgdCents).toBe(8000 + 10000);
  });

  it("charges a blind's per-unit add-on flat", () => {
    const q = windowQuote(
      {
        widthCm: 230,
        blindPrice: { costRmbCents: 1000, saleSgdCents: 4000, label: "Zen" },
        addons: [perUnit],
      },
      ASSUMPTIONS,
    );
    expect(q.saleSgdCents).toBe(Math.round(2.3 * 4000) + 13000);
  });

  it("keeps add-on cost out of a blind's air-freight base", () => {
    const q = windowQuote(
      {
        widthCm: 200,
        blindPrice: { costRmbCents: 1000, saleSgdCents: 4000, label: "Zen" },
        addons: [perMetre],
      },
      ASSUMPTIONS,
    );
    // curtainCostRmbCents is the freight base: the covering alone.
    expect(q.curtainCostRmbCents).toBe(2000);
  });

  it("emits a leg per add-on, alongside the blind's own", () => {
    const q = windowQuote(
      {
        widthCm: 200,
        blindPrice: { costRmbCents: 1000, saleSgdCents: 4000, label: "Zen" },
        addons: [perMetre],
      },
      ASSUMPTIONS,
    );
    expect(q.legs.map((l) => l.label)).toEqual(["Blind", "Blackout"]);
  });

  it("charges NO add-on when the window has no covering", () => {
    // The window that would otherwise be charged a per-unit surcharge while
    // reporting offering: "none" — see spec §5.1.
    const q = windowQuote({ widthCm: 230, addons: [perUnit] }, ASSUMPTIONS);
    expect(q.offering).toBe("none");
    expect(q.saleSgdCents).toBe(0);
    expect(q.costRmbCents).toBe(0);
    expect(q.legs).toEqual([]);
  });

  it("charges no add-on on an unmeasured blind", () => {
    const q = windowQuote(
      {
        widthCm: null,
        blindPrice: { costRmbCents: 1000, saleSgdCents: 4000, label: "Zen" },
        addons: [perUnit],
      },
      ASSUMPTIONS,
    );
    expect(q.saleSgdCents).toBe(0);
  });

  it("still ignores a combo on a blind, but keeps its add-ons", () => {
    const q = windowQuote(
      {
        widthCm: 200,
        blindPrice: { costRmbCents: 1000, saleSgdCents: 4000, label: "Zen" },
        addons: [perMetre],
        comboPriceSgdCents: 99900,
      },
      ASSUMPTIONS,
    );
    expect(q.saleSgdCents).toBe(8000 + 10000);
  });

  it("still lets a combo override a curtain's sale while add-on cost counts", () => {
    const q = windowQuote(
      {
        widthCm: 200,
        dayPrice: { costRmbCents: 1000, saleSgdCents: 4000, label: "Essential" },
        addons: [perMetre],
        comboPriceSgdCents: 50000,
      },
      ASSUMPTIONS,
    );
    expect(q.saleSgdCents).toBe(50000);
    expect(q.costRmbCents).toBeGreaterThan(5400);
  });
});
```

**Also update the existing tests in this file:** delete the `BOOK` constant, remove `BOOK` from every `windowQuote` / `computeQuote` call, and replace `addSFold: true` / `addSlimTracks: true` on window fixtures with `addons: [...]` entries carrying the same prices the old `BOOK` held.

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test -- src/lib/pricing/calculator.test.ts`
Expected: FAIL — `addons` is not a known property, `windowQuote` expects 3 arguments.

- [ ] **Step 3: Change the types**

In `src/lib/pricing/calculator.ts`, delete the `CalcAddonBook` type entirely and import the shared shape instead. Near the existing `AddonPrice` type:

```ts
import type { CalcAddon } from "@/lib/orders/window-addons";
```

Replace `CalcAddonBook` and the two boolean fields on `CalcWindow`:

```ts
// DELETE:
//   export type CalcAddonBook = { sFold?: ...; slimTracks?: ... };
//   addSFold: boolean;
//   addSlimTracks: boolean;

// ADD to CalcWindow, replacing them:
  /**
   * The add-ons this window carries, already resolved. The calculator prices
   * them; it does not decide them — see lib/orders/window-addons.ts.
   */
  addons?: CalcAddon[];
```

Keep `AddonPrice` and `addonLeg` as they are — `CalcAddon` is structurally compatible with `AddonPrice` plus a label.

- [ ] **Step 4: Change `windowQuote`**

Drop the `book` parameter:

```ts
export function windowQuote(
  win: CalcWindow,
  a: WindowAssumptions,
): Money & { /* …unchanged… */ } {
```

Add this helper just above `windowQuote`:

```ts
// An add-on is a charge on a covering. A window with nothing hanging in it
// takes none — otherwise a per-unit add-on charges a window that reports
// offering: "none". Per-metre add-ons hide this (addonLeg returns zero with no
// width); per-unit ones do not, and extra_shipping is the first of those.
function addonLegs(
  addons: CalcAddon[] | undefined,
  widthCm: number | null,
  costWidthCm: number | null | undefined,
): { total: Money; legs: CogsLeg[] } {
  let total: Money = ZERO;
  const legs: CogsLeg[] = [];
  for (const addon of addons ?? []) {
    const leg = addonLeg(addon, widthCm, costWidthCm);
    total = add(total, leg);
    legs.push({ label: addon.label, detail: null, rmbCents: leg.costRmbCents });
  }
  return { total, legs };
}
```

In the blind branch (currently `:418-446`), replace the whole `return` with:

```ts
  if (win.blindPrice) {
    const leg = blindLeg(win.blindPrice, win.widthCm, win.costWidthCm);
    const measured = win.widthCm != null && win.widthCm > 0;
    // No covering, no add-on (see addonLegs). An unmeasured blind is free on
    // both sides, and a flat per-unit add-on must not be the exception.
    const extra = measured
      ? addonLegs(win.addons, win.widthCm, win.costWidthCm)
      : { total: ZERO, legs: [] as CogsLeg[] };
    // A combo is a curtain bundle (day + night + track at a fixed price) and is
    // deliberately NOT honoured here — comboPriceSgdCents is ignored rather
    // than applied, so a combo left over from a switched-back window can't
    // override a blind's price.
    return {
      costRmbCents: leg.costRmbCents + extra.total.costRmbCents,
      saleSgdCents: leg.saleSgdCents + extra.total.saleSgdCents,
      // The air-freight base is the covering alone: add-ons are excluded here
      // exactly as they are on the curtain side.
      curtainCostRmbCents: leg.costRmbCents,
      offering: measured ? "blind" : "none",
      // A blind carries its own headrail — there is no separate track to buy.
      trackRmbCents: 0,
      trackKind: null,
      // With an add-on a blind now has MORE than one leg, so computeQuote's
      // `legs.length > 1` guard starts printing the Blind line beside them.
      // That is intended: a blind with blackout should show what it is made of.
      legs: charged([
        {
          label: "Blind",
          detail: win.blindPrice.label ?? null,
          rmbCents: leg.costRmbCents,
        },
        ...extra.legs,
      ]),
    };
  }
```

In the curtain path, replace the two `if (win.addSFold)` / `if (win.addSlimTracks)` blocks (`:487-501`) with:

```ts
  // No covering, no add-on: hasDay/hasNight are false unless a series is
  // priced AND the window is measured, which is exactly the condition that
  // makes an add-on a charge on something.
  if (hasDay || hasNight) {
    const extra = addonLegs(win.addons, win.widthCm, win.costWidthCm);
    total = add(total, extra.total);
    legs.push(...extra.legs);
  }
```

- [ ] **Step 5: Change `computeQuote`**

Drop the `book` parameter and stop threading it into `windowQuote`:

```ts
export function computeQuote(
  windows: CalcWindow[],
  a: CalcAssumptions,
  freightMode: FreightMode = "air",
  extraInstallSgdCents = 0,
  discountBps = 0,
): QuoteResult {
```

Inside, the `windowQuote(w, book, a)` call becomes `windowQuote(w, a)`.

- [ ] **Step 6: Fix the stale comment at `:433`**

The comment beginning *"One covering, so the window IS its leg"* is now false — the replacement text in Step 4 already covers this. Verify no copy of it survives:

```bash
grep -n "the window IS its leg" src/lib/pricing/calculator.ts
```

Expected: no output.

- [ ] **Step 7: Run the tests**

Run: `npm run test -- src/lib/pricing/calculator.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/pricing/calculator.ts src/lib/pricing/calculator.test.ts
git commit -m "feat(pricing): price a window's add-ons from a list, blinds included"
```

---

## Stage D — Loading and quoting

### Task 7: Load add-ons by window

**Files:**
- Create: `src/lib/db/window-addons.ts`

- [ ] **Step 1: Write the module**

```ts
import "server-only";

import { db } from "@/lib/db/kysely";
import type { AddonRule, CalcAddon } from "@/lib/orders/window-addons";

/** Every add-on row, unfiltered — the resolver decides what to drop. */
export async function loadAddonCatalogue(): Promise<AddonRule[]> {
  const rows = await db
    .selectFrom("pricing_addons")
    .select([
      "id",
      "key",
      "label",
      "cost_rmb_cents",
      "sale_sgd_cents",
      "basis",
      "applies_to",
      "auto_rule",
      "auto_width_over_cm",
      "is_active",
    ])
    // The ONLY thing that makes the form's checkbox order stable across an
    // admin edit. Without it Postgres returns these in whatever order suits it.
    .orderBy("is_active", "desc")
    .orderBy("label", "asc")
    .execute();

  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    label: r.label,
    costRmbCents: r.cost_rmb_cents,
    saleSgdCents: r.sale_sgd_cents,
    basis: r.basis,
    appliesTo: r.applies_to,
    autoRule: r.auto_rule,
    autoWidthOverCm: r.auto_width_over_cm,
    isActive: r.is_active,
  }));
}

/** windowId → the add-on ids it currently carries. */
export async function loadWindowAddonIds(
  windowIds: readonly string[],
): Promise<Map<string, string[]>> {
  const byWindow = new Map<string, string[]>();
  if (windowIds.length === 0) return byWindow;

  const rows = await db
    .selectFrom("window_addons")
    .select(["window_id", "addon_id"])
    .where("window_id", "in", windowIds)
    .execute();

  for (const r of rows) {
    byWindow.set(r.window_id, [...(byWindow.get(r.window_id) ?? []), r.addon_id]);
  }
  return byWindow;
}

/**
 * windowId → the add-ons it carries, priced, for the calculator.
 *
 * Reads the join rows as written: a saved order's quote must reproduce what was
 * agreed, not what today's rules would decide.
 */
export async function loadWindowCalcAddons(
  orderIds: readonly string[],
): Promise<Map<string, CalcAddon[]>> {
  const byWindow = new Map<string, CalcAddon[]>();
  if (orderIds.length === 0) return byWindow;

  const rows = await db
    .selectFrom("window_addons")
    .innerJoin("windows", "windows.id", "window_addons.window_id")
    .innerJoin("rooms", "rooms.id", "windows.room_id")
    .innerJoin("pricing_addons", "pricing_addons.id", "window_addons.addon_id")
    .select([
      "window_addons.window_id as window_id",
      "pricing_addons.label as label",
      "pricing_addons.cost_rmb_cents as cost_rmb_cents",
      "pricing_addons.sale_sgd_cents as sale_sgd_cents",
      "pricing_addons.basis as basis",
    ])
    .where("rooms.order_id", "in", orderIds)
    .orderBy("pricing_addons.label", "asc")
    .execute();

  for (const r of rows) {
    byWindow.set(r.window_id, [
      ...(byWindow.get(r.window_id) ?? []),
      {
        label: r.label,
        costRmbCents: r.cost_rmb_cents,
        saleSgdCents: r.sale_sgd_cents,
        basis: r.basis,
      },
    ]);
  }
  return byWindow;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "db/window-addons" || echo "clean"`
Expected: `clean` (other files still error — that's Stage D/E work).

- [ ] **Step 3: Commit**

```bash
git add src/lib/db/window-addons.ts
git commit -m "feat(db): load add-on rules and a window's add-ons"
```

---

### Task 8: Quote from the persisted join

**Files:**
- Modify: `src/lib/pricing/order-quote.ts` (`:33-38` `CalcConfig`, `:76-113` `loadCalcConfig`, `:339-368` `WindowPriceRow`, `:369-425` `rowToCalcWindow`, `:427-449` `addonRowsToBook`, `:483-527` first select, `:578-585` `computeQuote` call, `:637-682` second select, `:726-741` stale-flags call)

- [ ] **Step 1: Replace `book` on `CalcConfig` with the catalogue**

```ts
export type CalcConfig = {
  assumptions: CalcAssumptions;
  /**
   * Every add-on row, unfiltered. The form's resolver decides what to show —
   * filtering here would be filtering the resolver can no longer undo, and
   * would delete archived-but-selected add-ons on the next save.
   */
  addonCatalogue: AddonRule[];
  minMarginBps: number;
  minMarginCarousellBps: number;
};
```

Update the imports at the top of the file: drop `type CalcAddonBook`, add

```ts
import type { AddonRule, CalcAddon } from "@/lib/orders/window-addons";
import { loadAddonCatalogue, loadWindowCalcAddons } from "@/lib/db/window-addons";
```

- [ ] **Step 2: Rewrite `loadCalcConfig`**

Replace the `pricing_addons` select and the `book` construction (`:84-113`):

```ts
export async function loadCalcConfig(): Promise<CalcConfig | null> {
  const [assumptionsRow, addonCatalogue] = await Promise.all([
    db
      .selectFrom("pricing_assumptions")
      .selectAll()
      .where("singleton", "=", true)
      .executeTakeFirst(),
    loadAddonCatalogue(),
  ]);
  if (!assumptionsRow) return null;

  return {
    assumptions: assumptionsRowToCalc(assumptionsRow),
    // The rail is not in here: it is one cost-per-metre on the assumptions row,
    // not an add-on with a sale price and a basis. See CalcAssumptions.
    addonCatalogue,
    minMarginBps: assumptionsRow.min_margin_bps,
    minMarginCarousellBps: assumptionsRow.min_margin_carousell_bps,
  };
}
```

Delete `addonRowsToBook` entirely (`:427-449`).

- [ ] **Step 3: Change `WindowPriceRow` and `rowToCalcWindow`**

`WindowPriceRow` gains `id` and loses the two booleans and the three toilet columns:

```ts
type WindowPriceRow = {
  /** Needed to look this window's add-ons up. */
  id: string;
  room_label: string | null;
  room_position: number | null;
  width_cm: number | null;
  mfg_width_cm: number | null;
  day_cost: number | null;
  day_sale: number | null;
  day_series: string | null;
  night_cost: number | null;
  night_sale: number | null;
  night_series: string | null;
  blind_cost: number | null;
  blind_sale: number | null;
  blind_series: string | null;
  combo_price: number | null;
};
```

`rowToCalcWindow` takes the add-on map as a second argument. **This is deliberate** — it is what makes a call site that forgot to load them a type error rather than a silently wrong number:

```ts
function rowToCalcWindow(
  w: WindowPriceRow,
  addonsByWindow: Map<string, CalcAddon[]>,
): CalcWindow {
  const where = {
    roomIndex: w.room_position ?? undefined,
    roomLabel: w.room_label,
  };
  const addons = addonsByWindow.get(w.id) ?? [];

  // A blind occupies the window instead of curtains: no day/night leg and no
  // combo. It DOES carry add-ons — that is new in Phase 14.
  if (w.blind_sale != null || w.blind_cost != null) {
    return {
      ...where,
      widthCm: w.width_cm,
      costWidthCm: w.mfg_width_cm,
      blindPrice: {
        costRmbCents: w.blind_cost,
        saleSgdCents: w.blind_sale,
        label: w.blind_series,
      },
      addons,
      comboPriceSgdCents: null,
    };
  }

  const dayPrice =
    w.day_sale != null || w.day_cost != null
      ? {
          costRmbCents: w.day_cost,
          saleSgdCents: w.day_sale,
          label: w.day_series,
        }
      : null;
  const nightPrice =
    w.night_sale != null || w.night_cost != null
      ? {
          costRmbCents: w.night_cost,
          saleSgdCents: w.night_sale,
          label: w.night_series,
        }
      : null;
  return {
    ...where,
    widthCm: w.width_cm,
    costWidthCm: w.mfg_width_cm,
    dayPrice,
    nightPrice,
    addons,
    comboPriceSgdCents: w.combo_price,
  };
}
```

- [ ] **Step 4: Fix both window selects**

In **both** the `computeOrderQuote` select (`:483`) and the stale-flags sweep select (`:637`), make the same four edits:

1. Delete the two toilet joins:
   ```ts
   .leftJoin("curtain_types as tct", "tct.id", "windows.curtain_type_id")
   .leftJoin("curtain_series as tcs", "tcs.id", "tct.series_id")
   ```
2. Add `"windows.id as id",` as the first selected column.
3. Delete `"windows.add_s_fold as add_s_fold",` and `"windows.add_slim_tracks as add_slim_tracks",`.
4. Delete `"tcs.cost_rmb_cents as toilet_cost",`, `"tcs.sale_sgd_cents as toilet_sale",` and `"tcs.name as toilet_series",`.

- [ ] **Step 5: Load add-ons alongside, and pass them in**

In `computeOrderQuote`, add `loadWindowCalcAddons([orderId])` to the `Promise.all` and use it:

```ts
  const [order, windows, assumptionsRow, windowAddons] = await Promise.all([
    /* order select … */,
    /* windows select … */,
    /* assumptions select … */,
    loadWindowCalcAddons([orderId]),
  ]);
```

and the curtain branch of the `result` ternary becomes:

```ts
      : computeQuote(
          windows.map((w) => rowToCalcWindow(w, windowAddons)) satisfies CalcWindow[],
          a,
          order?.freight_mode ?? "air",
          order?.extra_install_sgd_cents ?? 0,
          order?.discount_bps ?? 0,
        );
```

In the stale-flags sweep, replace the trailing `pricing_addons` select in its `Promise.all` with `loadWindowCalcAddons(orderIds)`, and:

```ts
  const windowsByOrder = new Map<string, CalcWindow[]>();
  for (const w of windows) {
    const list = windowsByOrder.get(w.order_id) ?? [];
    list.push(rowToCalcWindow(w, windowAddons));
    windowsByOrder.set(w.order_id, list);
  }
```

Drop `book` from the `computeStaleFlags({...})` call.

**Why this select matters as much as the quote one:** miss the add-ons here and the sweep computes every add-on-carrying window without them, so its total differs from the saved baseline and unchanged orders are flagged stale — silently, on a screen nobody would think to distrust.

- [ ] **Step 6: Commit**

```bash
git add src/lib/pricing/order-quote.ts
git commit -m "feat(pricing): quote a window's add-ons from what was persisted"
```

---

### Task 9: Drop `book` from the staleness input

**Files:**
- Modify: `src/lib/pricing/stale-flags.ts:10-14,32-39,60-67`
- Test: `src/lib/pricing/stale-flags.test.ts`

- [ ] **Step 1: Update the tests**

In `stale-flags.test.ts`, delete `book` from every `computeStaleFlags` input object and delete any `BOOK`/`CalcAddonBook` fixture. Where a window fixture used `addSFold` / `addSlimTracks`, use `addons: []`.

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test -- src/lib/pricing/stale-flags.test.ts`
Expected: FAIL — `book` is required by `StaleFlagsInput`.

- [ ] **Step 3: Update the module**

Drop `CalcAddonBook` from the import, delete `book: CalcAddonBook;` from `StaleFlagsInput`, and change the `computeQuote` call:

```ts
        : computeQuote(
            input.windowsByOrder.get(o.id) ?? [],
            input.assumptions,
            o.freight_mode,
            o.extra_install_sgd_cents,
            o.discount_bps,
          );
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -- src/lib/pricing/stale-flags.test.ts src/lib/pricing/quote-staleness.test.ts`
Expected: PASS. (`quote-staleness.test.ts:117` also calls `computeQuote` — drop its `BOOK` argument too.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/pricing/stale-flags.ts src/lib/pricing/stale-flags.test.ts src/lib/pricing/quote-staleness.test.ts
git commit -m "refactor(pricing): the add-on book is no longer a quote input"
```

---

## Stage E — Validation and persistence

### Task 10: Retire the toilet variant from the schemas

**Files:**
- Modify: `src/lib/validation/order.ts:59-101,199-213,236-250`
- Test: `src/lib/validation/order.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/validation/order.test.ts`:

```ts
describe("window variants after Phase 14", () => {
  it("rejects a toilet variant", () => {
    const r = windowSchema.safeParse({
      variant: "toilet",
      position: 0,
      curtain_type_id: "00000000-0000-0000-0000-000000000001",
    });
    expect(r.success).toBe(false);
  });

  it("accepts addon_ids on a regular window", () => {
    const r = windowSchema.safeParse({
      variant: "regular",
      position: 0,
      addon_ids: ["00000000-0000-0000-0000-000000000001"],
    });
    expect(r.success).toBe(true);
  });

  it("accepts addon_ids on a blind window", () => {
    const r = windowSchema.safeParse({
      variant: "blind",
      position: 0,
      addon_ids: ["00000000-0000-0000-0000-000000000001"],
    });
    expect(r.success).toBe(true);
  });

  it("defaults addon_ids to an empty list", () => {
    const r = windowSchema.parse({ variant: "blind", position: 0 });
    expect(r.addon_ids).toEqual([]);
  });
});
```

Also delete or rewrite every existing assertion in this file that constructs a `toilet` window or a `curtain_type_id`.

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test -- src/lib/validation/order.test.ts`
Expected: FAIL — the toilet variant still parses; `addon_ids` is stripped.

- [ ] **Step 3: Edit `src/lib/validation/order.ts`**

On `baseWindow`, add:

```ts
const baseWindow = z.object({
  position: z.number().int().min(0),
  width_cm: optionalInt,
  height_cm: optionalInt,
  notes: z.string().max(2000).optional(),
  // Which add-ons are ticked. The server re-resolves this against the
  // catalogue before persisting — see lib/actions/orders.ts — so a payload
  // cannot attach an out-of-scope or archived add-on.
  addon_ids: z.array(z.string().uuid()).default([]),
});
```

On `regularWindow`, delete `add_s_fold` and `add_slim_tracks`.

Delete `toiletWindow` and `toiletWindowEdit` entirely, and shrink both unions:

```ts
export const windowSchema = z.discriminatedUnion("variant", [
  regularWindow,
  blindWindow,
]);
```

```ts
export const windowEditSchema = z.discriminatedUnion("variant", [
  regularWindowEdit,
  blindWindowEdit,
]);
```

On `draftWindow`: change `variant` to `z.enum(["regular", "blind"])` and delete `curtain_type_id`.

Leave `isToiletRoom` in place — it now means "this room's windows are blinds".

- [ ] **Step 4: Run the tests**

Run: `npm run test -- src/lib/validation/order.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validation/order.ts src/lib/validation/order.test.ts
git commit -m "feat(orders): a window is a curtain or a blind, and carries add-on ids"
```

---

### Task 11: `windowValues` drops the retired columns

**Files:**
- Modify: `src/lib/orders/window-values.ts`
- Test: `src/lib/orders/window-values.test.ts`

- [ ] **Step 1: Update the tests**

Delete every `toilet`-variant case in `window-values.test.ts` and every assertion on `curtain_type_id`, `add_s_fold`, `add_slim_tracks`. Add:

```ts
it("nulls every curtain column for a blind", () => {
  const v = windowValues(
    { variant: "blind", blind_type_id: "b", draw: "Single Left" },
    0,
  );
  expect(v.day_curtain_type_id).toBeNull();
  expect(v.night_curtain_type_id).toBeNull();
  expect(v.combo_id).toBeNull();
  expect(v.blind_type_id).toBe("b");
  expect(v.draw).toBe("Single Left");
});

it("has no add-on columns — they live in window_addons now", () => {
  const v = windowValues({ variant: "regular" }, 0);
  expect(v).not.toHaveProperty("add_s_fold");
  expect(v).not.toHaveProperty("add_slim_tracks");
  expect(v).not.toHaveProperty("curtain_type_id");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test -- src/lib/orders/window-values.test.ts`
Expected: FAIL.

- [ ] **Step 3: Rewrite the module**

```ts
import type { DRAW_DIRECTION_VALUES } from "@/lib/validation/order";

type DrawDirection = (typeof DRAW_DIRECTION_VALUES)[number];

// The subset of validated-window fields the DB mapping reads. Accepts create,
// edit, and draft window shapes structurally so all three persistence paths
// share one mapping.
//
// addon_ids is deliberately NOT here: add-ons are rows in window_addons, not
// columns on windows, and the action writes them after the window row.
export type WindowLike = {
  variant: "regular" | "blind";
  width_cm?: number | null;
  height_cm?: number | null;
  notes?: string;
  day_curtain_type_id?: string;
  night_curtain_type_id?: string;
  blind_type_id?: string;
  draw?: DrawDirection;
  combo_id?: string;
};

// Every column on public.windows that the shape trigger cares about. A uniform
// shape for both variants keeps the insert/update call sites simple: the
// opposite variant's columns are always explicitly nulled so the
// validate_window_shape() trigger is satisfied when a room switches type.
export type WindowColumnValues = {
  position: number;
  width_cm: number | null;
  height_cm: number | null;
  notes: string | null;
  day_curtain_type_id: string | null;
  night_curtain_type_id: string | null;
  blind_type_id: string | null;
  draw: DrawDirection | null;
  combo_id: string | null;
};

export function windowValues(
  win: WindowLike,
  position: number,
): WindowColumnValues {
  const base = {
    position,
    width_cm: win.width_cm ?? null,
    height_cm: win.height_cm ?? null,
    notes: win.notes || null,
  } as const;

  // A blind occupies the window INSTEAD of curtains, so every curtain column is
  // nulled — including the combo, which is a curtain bundle. `draw` survives:
  // for a blind it carries the control side.
  if (win.variant === "blind") {
    return {
      ...base,
      day_curtain_type_id: null,
      night_curtain_type_id: null,
      blind_type_id: win.blind_type_id ?? null,
      draw: win.draw ?? null,
      combo_id: null,
    };
  }

  return {
    ...base,
    day_curtain_type_id: win.day_curtain_type_id ?? null,
    night_curtain_type_id: win.night_curtain_type_id ?? null,
    blind_type_id: null,
    draw: win.draw ?? null,
    combo_id: win.combo_id ?? null,
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -- src/lib/orders/window-values.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/orders/window-values.ts src/lib/orders/window-values.test.ts
git commit -m "refactor(orders): windowValues maps two variants, not three"
```

---

### Task 12: Persist add-ons on all three write paths

**Files:**
- Modify: `src/lib/actions/orders.ts` (`createOrder` ~`:93-115`, `updateOrder` ~`:203-265`, `createOrderDraft` ~`:471-497`)

The rule this task enforces: **the actions trust the database over the payload.** Every path re-resolves against the freshly-read catalogue and writes the resolved set.

- [ ] **Step 1: Add the shared helper**

Near the top of `src/lib/actions/orders.ts`:

```ts
import { loadAddonCatalogue, loadWindowAddonIds } from "@/lib/db/window-addons";
import {
  resolveWindowAddons,
  selectedAddonIds,
  type AddonRule,
} from "@/lib/orders/window-addons";
```

and, below the imports:

```ts
/**
 * Re-resolve a window's add-ons server-side and write them.
 *
 * The browser's locked checkboxes are UX; this is the guarantee. A payload that
 * omits extra_shipping on a 230cm blind gets it charged anyway, one that
 * attaches a curtain add-on to a blind has it dropped, and one that attaches an
 * archived add-on to a NEW window has it dropped too — `persistedIds` is empty
 * there, and only the database may say an add-on was already present.
 */
async function writeWindowAddons(
  trx: Transaction<DB>,
  windowId: string,
  win: { variant: "regular" | "blind"; width_cm?: number | null; addon_ids?: string[] },
  catalogue: AddonRule[],
  persistedIds: readonly string[],
): Promise<void> {
  const resolved = resolveWindowAddons(
    win.variant === "blind" ? "blind" : "curtain",
    win.width_cm ?? null,
    win.addon_ids ?? [],
    persistedIds,
    catalogue,
  );
  const ids = selectedAddonIds(resolved);

  await trx
    .deleteFrom("window_addons")
    .where("window_id", "=", windowId)
    .execute();
  if (ids.length > 0) {
    await trx
      .insertInto("window_addons")
      .values(ids.map((addon_id) => ({ window_id: windowId, addon_id })))
      .execute();
  }
}
```

Import `Transaction` and `DB` from Kysely/`@/lib/db/schema` following the file's existing conventions.

- [ ] **Step 2: `createOrder`**

Load the catalogue once before the transaction:

```ts
const addonCatalogue = await loadAddonCatalogue();
```

Change the shape guard (`:102`) — a toilet room takes a blind:

```ts
        const matchesShape = isToilet
          ? win.variant === "blind"
          : win.variant === "regular" || win.variant === "blind";
```

Capture the inserted id and write the add-ons (`:111`):

```ts
        const insertedWin = await trx
          .insertInto("windows")
          .values({ room_id: insertedRoom.id, ...windowValues(win, w) })
          .returning("id")
          .executeTakeFirstOrThrow();
        // No persisted state on a create — the payload cannot claim any.
        await writeWindowAddons(trx, insertedWin.id, win, addonCatalogue, []);
```

- [ ] **Step 3: `updateOrder`**

Before the transaction, load the catalogue and the currently-persisted ids for this order's windows:

```ts
const addonCatalogue = await loadAddonCatalogue();
const existingWindowIds = (
  await db
    .selectFrom("windows")
    .innerJoin("rooms", "rooms.id", "windows.room_id")
    .select("windows.id as id")
    .where("rooms.order_id", "=", orderId)
    .execute()
).map((r) => r.id);
const persistedByWindow = await loadWindowAddonIds(existingWindowIds);
```

Apply the same shape-guard change at `:236`. Then after each branch of the window upsert:

```ts
        if (win.id) {
          await trx.updateTable("windows") /* …unchanged… */;
          keepWindowIds.push(win.id);
          await writeWindowAddons(
            trx,
            win.id,
            win,
            addonCatalogue,
            persistedByWindow.get(win.id) ?? [],
          );
        } else {
          const insertedWin = await trx
            .insertInto("windows")
            .values({ room_id: roomId, ...values })
            .returning("id")
            .executeTakeFirstOrThrow();
          keepWindowIds.push(insertedWin.id);
          await writeWindowAddons(trx, insertedWin.id, win, addonCatalogue, []);
        }
```

- [ ] **Step 4: `createOrderDraft`**

Change the variant shaping at `:483` — a toilet room's window is a blind:

```ts
        const shaped = {
          ...win,
          variant:
            win.variant === "blind" || isToilet
              ? ("blind" as const)
              : ("regular" as const),
        };
```

and capture the id so add-ons are written here too (drafts are relaxed about *completeness*, never about *correctness of charge*):

```ts
        const insertedWin = await trx
          .insertInto("windows")
          .values({ room_id: insertedRoom.id, ...windowValues(shaped, w) })
          .returning("id")
          .executeTakeFirstOrThrow();
        await writeWindowAddons(trx, insertedWin.id, shaped, addonCatalogue, []);
```

with `const addonCatalogue = await loadAddonCatalogue();` before this function's transaction.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "actions/orders" || echo "clean"`
Expected: `clean`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/actions/orders.ts
git commit -m "feat(orders): resolve add-ons server-side on every write path"
```

---

## Stage F — The consultation form

### Task 13: The add-ons row

**Files:**
- Create: `src/components/orders/consultation-form/addon-checkboxes.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useFormContext, useWatch } from "react-hook-form";

import type { OrderEditInput } from "@/lib/validation/order";
import {
  resolveWindowAddons,
  type AddonRule,
} from "@/lib/orders/window-addons";

type Props = {
  roomIndex: number;
  windowIndex: number;
  covering: "curtain" | "blind";
  catalogue: AddonRule[];
  /**
   * What window_addons held when this form loaded. FIXED for the life of the
   * edit — not the live form state — so clearing a retired add-on leaves it
   * listed and unticked rather than vanishing mid-edit.
   */
  persistedIds: string[];
};

export function AddonCheckboxes({
  roomIndex,
  windowIndex,
  covering,
  catalogue,
  persistedIds,
}: Props) {
  const { control, setValue } = useFormContext<OrderEditInput>();
  const base = `rooms.${roomIndex}.windows.${windowIndex}` as const;

  const widthCm = useWatch({ control, name: `${base}.width_cm` });
  const selected: string[] =
    useWatch({ control, name: `${base}.addon_ids` }) ?? [];

  const width =
    widthCm == null || widthCm === ("" as unknown) ? null : Number(widthCm);
  const resolved = resolveWindowAddons(
    covering,
    Number.isFinite(width) ? (width as number) : null,
    selected,
    persistedIds,
    catalogue,
  );

  // Nothing to offer → no "Add-ons:" label with nothing under it.
  if (resolved.length === 0) return null;

  function toggle(id: string, on: boolean) {
    const next = on
      ? [...new Set([...selected, id])]
      : selected.filter((x) => x !== id);
    setValue(`${base}.addon_ids`, next, { shouldDirty: true });
  }

  return (
    <div className="col-span-2 sm:col-span-6 flex flex-wrap items-center gap-x-6 gap-y-2 pt-0.5">
      <span className="text-xs font-medium text-slate-600">Add-ons:</span>
      {resolved.map((a) => (
        <label
          key={a.id}
          className={`flex items-center gap-1.5 text-xs ${
            a.locked ? "text-slate-500" : "text-slate-700"
          }`}
        >
          <input
            type="checkbox"
            checked={a.selected}
            onChange={(e) => toggle(a.id, e.target.checked)}
            // NOT `disabled`: React Hook Form drops disabled fields from
            // submitted values, which would lose the very charge the lock
            // exists to guarantee. `readOnly` is inert on a checkbox. So:
            // block the mouse, block the keyboard, and tell assistive tech.
            {...(a.locked
              ? {
                  tabIndex: -1,
                  "aria-disabled": true,
                  className:
                    "rounded border-slate-300 text-teal-600 focus:ring-teal-500 pointer-events-none opacity-70",
                }
              : {
                  className:
                    "rounded border-slate-300 text-teal-600 focus:ring-teal-500",
                })}
          />
          {a.label}
          {a.locked && a.autoRule === "width_over" && (
            <span className="text-[11px] text-slate-400">
              required over {a.autoWidthOverCm} cm
            </span>
          )}
        </label>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Do not "fix" the locked checkbox into form state**

A locked add-on's id is deliberately **not** written into `addon_ids`. It doesn't need to be: the live quote calls `resolveWindowAddons` itself and gets `selected: true` from the rule, and the server re-resolves on save and forces it on. Syncing it into form state via an effect would add a second source of truth that can drift from the rule — the exact shape of bug this phase exists to remove.

- [ ] **Step 3: Commit**

```bash
git add src/components/orders/consultation-form/addon-checkboxes.tsx
git commit -m "feat(orders): one add-ons row, driven by the resolver"
```

---

### Task 14: Two window branches, not three

**Files:**
- Modify: `src/components/orders/consultation-form/window-fields.tsx` (`:84-140` `CoveringToggle`, `:150-206` props/setup, `:207-278` blind branch, `:281-339` toilet branch — deleted, `:406-424` add-ons row)

- [ ] **Step 1: Change the props**

`WindowFields` gains the catalogue and the window's persisted ids:

```ts
type Props = {
  roomIndex: number;
  windowIndex: number;
  isToilet: boolean;
  curtainTypes: CurtainTypeOption[];
  combos: ActiveCombo[];
  addonCatalogue: AddonRule[];
  persistedAddonIds: string[];
};
```

- [ ] **Step 2: Delete the toilet branch**

Remove the entire `if (isToilet) { … }` block (`:281-339`). Remove `const toiletId = useWatch({ control, name: `${base}.curtain_type_id` });` (`:200`).

- [ ] **Step 3: Force blind in a toilet room**

`setCovering` no longer has a toilet target:

```ts
  function setCovering(next: "curtain" | "blind") {
    if (next === "blind") {
      if (getValues(`${base}.draw`) === "Double") {
        setValue(`${base}.draw`, undefined, { shouldDirty: true });
      }
      setValue(`${base}.variant`, "blind", { shouldDirty: true });
      return;
    }
    setValue(`${base}.variant`, "regular", { shouldDirty: true });
    // Add-ons that no longer apply are dropped on the switch, mirroring how
    // the day/night selections already are. The resolver would hide them, but
    // leaving them in form state means resubmitting them on every save.
    setValue(`${base}.addon_ids`, [], { shouldDirty: true });
  }
```

Add the same `addon_ids` reset to the `next === "blind"` branch, before its `return`.

- [ ] **Step 4: Hide the toggle in toilet rooms, and handle the empty catalogue**

In the blind branch's JSX, replace the `<CoveringToggle …/>` with:

```tsx
        {!isToilet && (
          <CoveringToggle
            isBlind
            onChange={setCovering}
            blindsAvailable={blindOptions.length > 0}
          />
        )}
        {isToilet && blindOptions.length === 0 && (
          <p className="col-span-2 sm:col-span-6 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            No blind has a price yet, so there is nothing to put in this window.
            Price a blind series under Product → Blinds first.
          </p>
        )}
```

The toilet room's own `CoveringToggle` `stranded` message can no longer surface, which is why this empty state exists — see spec §6.1.

- [ ] **Step 5: Render add-ons on both branches**

Import the component and drop the two hard-coded checkboxes (`:406-424`), replacing them in the regular branch with:

```tsx
      <AddonCheckboxes
        roomIndex={roomIndex}
        windowIndex={windowIndex}
        covering="curtain"
        catalogue={addonCatalogue}
        persistedIds={persistedAddonIds}
      />
```

and adding the same block to the blind branch with `covering="blind"`, just above the Special Notes field.

- [ ] **Step 6: Commit**

```bash
git add src/components/orders/consultation-form/window-fields.tsx
git commit -m "feat(orders): a toilet window is a blind, and blinds take add-ons"
```

---

### Task 15: Room card and blank windows

**Files:**
- Modify: `src/components/orders/consultation-form/room-card.tsx:58-84,86-100,125-140`
- Modify: `src/components/orders/consultation-form/index.tsx:48-70`

- [ ] **Step 1: `index.tsx` — a toilet room's blank window is a blind**

```ts
function makeWindow(roomType: RoomType, position: number) {
  if (isToiletRoom(roomType)) {
    return {
      variant: "blind" as const,
      position,
      blind_type_id: "",
      width_cm: null,
      height_cm: null,
      notes: "",
      addon_ids: [] as string[],
    };
  }
  return {
    variant: "regular" as const,
    position,
    day_curtain_type_id: "",
    night_curtain_type_id: "",
    draw: "Double" as const,
    width_cm: null,
    height_cm: null,
    notes: "",
    combo_id: "",
    addon_ids: [] as string[],
  };
}
```

- [ ] **Step 2: `room-card.tsx` — the sync effect**

```ts
  useEffect(() => {
    if (!roomType) return;
    // A toilet room's windows are blinds. A blind elsewhere is left alone: it
    // is valid in every room type, and rewriting its variant would wipe the
    // chosen blind the moment someone corrected the room type.
    const targetVariant = isToilet ? "blind" : "regular";
    fields.forEach((_, i) => {
      const current = getValues(`rooms.${roomIndex}.windows.${i}.variant`);
      if (current === "blind") return;
      setValue(`rooms.${roomIndex}.windows.${i}.variant`, targetVariant, {
        shouldValidate: false,
        shouldDirty: false,
      });
      if (targetVariant === "blind") {
        setValue(`rooms.${roomIndex}.windows.${i}.day_curtain_type_id`, "", {
          shouldDirty: false,
        });
        setValue(`rooms.${roomIndex}.windows.${i}.night_curtain_type_id`, "", {
          shouldDirty: false,
        });
        setValue(`rooms.${roomIndex}.windows.${i}.combo_id`, "", {
          shouldDirty: false,
        });
        // Curtain add-ons don't survive the change of covering.
        setValue(`rooms.${roomIndex}.windows.${i}.addon_ids`, [], {
          shouldDirty: false,
        });
      }
    });
  }, [roomType, isToilet, roomIndex, fields, setValue, getValues]);
```

- [ ] **Step 3: `room-card.tsx` — `addWindow`**

Replace the toilet branch of `append(...)` with the blind shape used in Step 1, and add `addon_ids: []` to the regular branch.

- [ ] **Step 4: Thread the new props to `WindowFields`**

`RoomCard`'s props gain:

```ts
  addonCatalogue: AddonRule[];
  /** windowId → the add-on ids it had on load. New windows have no entry. */
  persistedAddonIdsByWindow: Record<string, string[]>;
```

and the `<WindowFields …/>` render (currently ~`:132`) gains:

```tsx
            addonCatalogue={addonCatalogue}
            persistedAddonIds={
              persistedAddonIdsByWindow[
                getValues(`rooms.${roomIndex}.windows.${i}.id`) ?? ""
              ] ?? []
            }
```

`index.tsx` declares the same two props on its own `Props` type, defaulting `persistedAddonIdsByWindow` to `{}`, reads the catalogue from `calcConfig?.addonCatalogue ?? []`, and forwards both to every `RoomCard`.

- [ ] **Step 5: Commit**

```bash
git add src/components/orders/consultation-form/room-card.tsx src/components/orders/consultation-form/index.tsx
git commit -m "feat(orders): toilet rooms start their windows as blinds"
```

---

### Task 16: The live quote

**Files:**
- Modify: `src/components/orders/consultation-form/live-quote.tsx:80-125`

- [ ] **Step 1: Map add-ons through the resolver**

Replace the blind branch and the toilet mapping:

```tsx
        if (w.variant === "blind") {
          return {
            ...where,
            widthCm: toWidthCm(w.width_cm),
            blindPrice: priceOf(w.blind_type_id || undefined),
            addons: toCalcAddons(
              resolveWindowAddons(
                "blind",
                toWidthCm(w.width_cm),
                w.addon_ids ?? [],
                persistedIdsFor(w.id),
                config.addonCatalogue,
              ),
            ),
            comboPriceSgdCents: null,
          };
        }

        const comboId = (w as { combo_id?: string }).combo_id;
        return {
          ...where,
          widthCm: toWidthCm(w.width_cm),
          dayPrice: priceOf(w.day_curtain_type_id || undefined),
          nightPrice: priceOf(w.night_curtain_type_id || undefined),
          addons: toCalcAddons(
            resolveWindowAddons(
              "curtain",
              toWidthCm(w.width_cm),
              w.addon_ids ?? [],
              persistedIdsFor(w.id),
              config.addonCatalogue,
            ),
          ),
          comboPriceSgdCents: comboId
            ? (comboPriceById.get(comboId) ?? null)
            : null,
        };
```

`persistedIdsFor` is a lookup into the same `persistedAddonIdsByWindow` map the form receives; a window with no id (new) gets `[]`.

- [ ] **Step 2: Drop `config.book` from the `computeQuote` call**

```tsx
    return computeQuote(
      windows,
      config.assumptions,
      freightMode,
      extraInstallCents,
      discountBps,
    );
```

Add `config.addonCatalogue` and the persisted map to the `useMemo` dependency array.

- [ ] **Step 3: Commit**

```bash
git add src/components/orders/consultation-form/live-quote.tsx
git commit -m "feat(orders): the live quote prices add-ons through the resolver"
```

---

### Task 17: Hydrate the edit page

**Files:**
- Modify: `src/app/(app)/orders/[orderId]/edit/page.tsx:279,313-360`
- Modify: `src/app/(app)/orders/new/page.tsx:94` (verify only)

**The regression this prevents:** `updateOrder` delete-then-inserts the resolved set, so anything the edit form fails to load, it deletes. Miss this and every edit wipes the window's add-ons, silently and permanently.

- [ ] **Step 1: Load the persisted ids**

Add to the page's data loading:

```ts
const persistedAddonIdsByWindow = Object.fromEntries(
  await loadWindowAddonIds(allWindowIds),
);
```

where `allWindowIds` is every window id already collected for `windowsByRoom`.

- [ ] **Step 2: Hydrate `addon_ids` into `defaultValues`**

In the blind branch of the window map:

```ts
            return {
              id: w.id,
              variant: "blind" as const,
              position: wIdx,
              blind_type_id: w.blind_type_id,
              draw: w.draw === "Double" ? undefined : (w.draw ?? undefined),
              width_cm: w.width_cm ?? null,
              height_cm: w.height_cm ?? null,
              notes: w.notes ?? "",
              addon_ids: persistedAddonIdsByWindow[w.id] ?? [],
            };
```

Delete the `if (isToilet) { … }` branch entirely — a toilet window without a `blind_type_id` now falls through to the regular branch, which is correct for a half-filled draft; the resolver and the trigger both accept it.

In the regular branch, replace `add_s_fold` / `add_slim_tracks` with:

```ts
            addon_ids: persistedAddonIdsByWindow[w.id] ?? [],
```

- [ ] **Step 3: Pass both new props to the form**

Both `edit/page.tsx` and `new/page.tsx` render the consultation form; both already call `loadCalcConfig()`, so the catalogue arrives on `calcConfig.addonCatalogue` with no new prop. Pass `persistedAddonIdsByWindow` from the edit page and `{}` from the new page.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "orders/\[orderId\]/edit\|orders/new" || echo "clean"`
Expected: `clean`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/orders/[orderId]/edit/page.tsx" "src/app/(app)/orders/new/page.tsx"
git commit -m "fix(orders): load a window's add-ons before the edit form can delete them"
```

---

## Stage G — Admin

### Task 18: Validate and save the new fields

**Files:**
- Modify: `src/lib/validation/pricing-settings.ts:105-120`
- Modify: `src/lib/actions/pricing-settings.ts:35-60`
- Test: `src/lib/validation/pricing-settings.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe("pricingAddonSchema — auto rules", () => {
  const base = {
    id: "00000000-0000-0000-0000-000000000001",
    label: "Extra shipping",
    basis: "per_unit" as const,
    applies_to: "blind" as const,
  };

  it("requires a threshold for width_over", () => {
    const r = pricingAddonSchema.safeParse({ ...base, auto_rule: "width_over" });
    expect(r.success).toBe(false);
  });

  it("accepts width_over with a threshold", () => {
    const r = pricingAddonSchema.safeParse({
      ...base,
      auto_rule: "width_over",
      auto_width_over_cm: 200,
    });
    expect(r.success).toBe(true);
  });

  it("rejects a threshold on a manual add-on", () => {
    const r = pricingAddonSchema.safeParse({
      ...base,
      auto_rule: "manual",
      auto_width_over_cm: 200,
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test -- src/lib/validation/pricing-settings.test.ts`
Expected: FAIL — the extra keys are stripped and every case passes.

- [ ] **Step 3: Extend the schema**

```ts
export const pricingAddonSchema = z
  .object({
    // Absent on a row being created — the action generates the key and the id.
    id: z.string().uuid().optional(),
    label: z.string().trim().min(1, "Required").max(120),
    cost_rmb: priceField,
    sale_sgd: priceField,
    basis: z.enum(["per_metre", "per_unit"]),
    applies_to: z.enum(["curtain", "blind", "both"]).default("curtain"),
    auto_rule: z.enum(["manual", "always", "width_over"]).default("manual"),
    auto_width_over_cm: z.coerce.number().int().positive().max(1000).nullable().optional(),
    is_active: z.boolean().optional(),
  })
  // Mirrors the pricing_addons_auto_width_agrees check constraint, so a bad
  // combination is a field error rather than a 500 from Postgres.
  .refine(
    (v) => v.auto_rule !== "width_over" || v.auto_width_over_cm != null,
    { message: "Enter the width it applies over", path: ["auto_width_over_cm"] },
  )
  .refine(
    (v) => v.auto_rule === "width_over" || v.auto_width_over_cm == null,
    { message: "Only 'over width' uses a threshold", path: ["auto_width_over_cm"] },
  );
```

- [ ] **Step 4: Save the new fields, and allow creation**

In `src/lib/actions/pricing-settings.ts`, extend `upsertPricingAddon` to insert when `id` is absent:

```ts
export async function upsertPricingAddon(input: unknown) {
  await requireRole(["admin"]);
  const parsed = pricingAddonSchema.parse(input);

  const money = (v: string | undefined) =>
    v && v !== "" ? dollarsToCents(v) : null;

  const values = {
    label: parsed.label,
    cost_rmb_cents: money(parsed.cost_rmb),
    sale_sgd_cents: money(parsed.sale_sgd),
    basis: parsed.basis,
    applies_to: parsed.applies_to,
    auto_rule: parsed.auto_rule,
    auto_width_over_cm: parsed.auto_width_over_cm ?? null,
  };

  try {
    if (parsed.id) {
      await db
        .updateTable("pricing_addons")
        .set(values)
        .where("id", "=", parsed.id)
        .execute();
    } else {
      // The key is derived from the label and is immutable thereafter. It
      // exists for the seeds and migrations to reference rows by name.
      const key = parsed.label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
      if (!key) throw new Error("Give the add-on a name with letters in it");
      await db.insertInto("pricing_addons").values({ key, ...values }).execute();
    }
  } catch (err) {
    throw new Error(userMessage(err, "Could not save add-on"));
  }
  revalidatePath(PATH);
}
```

`userMessage` already turns a unique-violation into a readable message; confirm the duplicate-key case reads sensibly and adjust the fallback string if not.

- [ ] **Step 5: Widen `AddonRow` in the admin loader**

In `src/lib/db/pricing-settings.ts`, add `applies_to`, `auto_rule`, `auto_width_over_cm` to both the `AddonRow` type and the `loadAddons` select and mapping. Leave `RETIRED_KEYS` exactly as it is — it is a display filter for this screen only, and `is_active` is what keeps those rows out of the consultation form.

- [ ] **Step 6: Run the tests**

Run: `npm run test -- src/lib/validation/pricing-settings.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/validation/pricing-settings.ts src/lib/actions/pricing-settings.ts src/lib/db/pricing-settings.ts src/lib/validation/pricing-settings.test.ts
git commit -m "feat(pricing): admins can scope an add-on and make it automatic"
```

---

### Task 19: The admin table

**Files:**
- Modify: `src/components/pricing/addons-table.tsx`

- [ ] **Step 1: Extend the draft shape and the row**

`Draft` gains `applies_to`, `auto_rule`, `auto_width_over_cm` (string, for the input) and an `isNew` flag. Add two selects and a conditional number input to each row, following the existing `Select` usage:

```tsx
const SCOPES = [
  { value: "curtain", label: "Curtains" },
  { value: "blind", label: "Blinds" },
  { value: "both", label: "Both" },
];
const AUTO = [
  { value: "manual", label: "By hand" },
  { value: "always", label: "Always" },
  { value: "width_over", label: "Over width" },
];
```

The threshold input renders only when `d.auto_rule === "width_over"`, with `placeholder="cm"` and `className="w-20"`.

- [ ] **Step 2: Add the charges-nothing warning**

Below each row's controls:

```tsx
{d.is_active && !d.cost && !d.sale && (
  <p className="w-full text-[11px] text-amber-700">
    {d.auto_rule === "manual"
      ? "Charges nothing, so it isn't offered on consultations."
      : "Applied automatically but charges nothing — it won't appear until you price it."}
  </p>
)}
```

**The test is null or zero, and it ignores `auto_rule`.** Both traps are live: `extra_shipping` is null/null and automatic, `blinds_surcharge` is 0/0 and manual. A warning keyed on only one of those misses the other, and this screen is the only place either becomes visible — the resolver keeps both off the consultation form until they are priced.

Note `d.cost` / `d.sale` are the decimal strings the form holds; `"0"` and `"0.00"` are truthy as strings, so compare numerically:

```tsx
const chargesNothing = !Number(d.cost || 0) && !Number(d.sale || 0);
```

- [ ] **Step 3: Add the "+ Add add-on" button**

Beside the existing Save button:

```tsx
<Button
  type="button"
  variant="outline"
  onClick={() =>
    setDrafts((d) => [
      ...d,
      {
        id: "",
        isNew: true,
        label: "",
        cost: "",
        sale: "",
        basis: "per_metre",
        applies_to: "curtain",
        auto_rule: "manual",
        auto_width_over_cm: "",
        is_active: true,
      },
    ])
  }
>
  + Add add-on
</Button>
```

and `saveAll` sends `id: d.isNew ? undefined : d.id`, refusing the call when any draft has a blank label:

```tsx
const blank = drafts.find((d) => d.label.trim() === "");
if (blank) {
  toast.error("Give every add-on a name before saving");
  return;
}
```

A new row has no `id`, so the archive button is hidden on it until it has been saved.

- [ ] **Step 4: Update the header row**

Add `Applies to`, `Auto` and `Over` to the `hidden sm:flex` header so the desktop columns still line up.

- [ ] **Step 5: Verify in the browser**

```bash
npm run dev
```

Open `http://localhost:3000/admin/pricing-settings`. Confirm: the five add-ons list; `Blinds Surcharge` and `Extra shipping` both show a warning; adding a row, naming it and saving works; setting Auto to "Over width" reveals the cm input and saving without one shows a field error.

- [ ] **Step 6: Commit**

```bash
git add src/components/pricing/addons-table.tsx
git commit -m "feat(pricing): scope, automate and add add-ons from the settings screen"
```

---

## Stage H — Remaining surfaces

### Task 20: Procurement and manufacture

**Files:**
- Modify: `src/lib/po/load.ts:287-288,306-307,376-382`
- Modify: `src/lib/manufacture/load.ts:113-116,134-137,150`
- Modify: `src/lib/po/track-order-load.ts:92`
- Modify: `src/lib/validation/procurement.ts:125`

- [ ] **Step 1: `po/load.ts`**

Delete the `toilet_ct` / `toilet_cs` joins, the `toilet_label` / `toilet_vendor_id` selects, and the whole `if (w.toilet_label) { … }` line branch. Update the "A window is ONE covering" comment at `:342` to say day/night curtains or a blind.

- [ ] **Step 2: `manufacture/load.ts`**

Delete the `toilet_ct` / `toilet_cs` joins and the `curtain_label` / `curtain_index` / `curtain_page` / `curtain_series` selects, plus any downstream use of them. Update the comment at `:150`.

- [ ] **Step 3: `track-order-load.ts`**

A toilet window no longer contributes a rail — it is a blind, and blinds carry their own headrail. Update the comment at `:92` and remove the toilet window from the count.

- [ ] **Step 4: `validation/procurement.ts`**

```ts
export const PO_TYPE_KEYS = ["day", "night", "blind", "mesh"] as const;
```

Leave the `po_type_labels` `'toilet'` row and its check constraint alone: nothing writes that key now (`actions/procurement.ts:153` is update-only), and deleting the row would be a hard delete for no benefit.

- [ ] **Step 5: Run the tests**

Run: `npm run test -- src/lib/validation/procurement.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/po src/lib/manufacture src/lib/validation/procurement.ts
git commit -m "refactor(procurement): a toilet window is a blind everywhere"
```

---

### Task 21: Order detail and summary card

**Files:**
- Modify: `src/components/orders/room-summary-card.tsx:35-36,103-135`
- Modify: `src/app/(app)/orders/[orderId]/page.tsx`

- [ ] **Step 1: Delete the toilet table**

Remove the `isToilet` helper and the `toilet ? … : …` conditional in `RoomSummaryCard`, keeping only the day/night table for `curtainWindows`.

- [ ] **Step 2: List add-ons by label**

In `orders/[orderId]/page.tsx`, load the labels alongside the windows:

```ts
const addonLabelsByWindow = new Map<string, string[]>();
for (const r of await db
  .selectFrom("window_addons")
  .innerJoin("windows", "windows.id", "window_addons.window_id")
  .innerJoin("rooms", "rooms.id", "windows.room_id")
  .innerJoin("pricing_addons", "pricing_addons.id", "window_addons.addon_id")
  .select(["window_addons.window_id as window_id", "pricing_addons.label as label"])
  .where("rooms.order_id", "=", orderId)
  .orderBy("pricing_addons.label", "asc")
  .execute()) {
  addonLabelsByWindow.set(r.window_id, [
    ...(addonLabelsByWindow.get(r.window_id) ?? []),
    r.label,
  ]);
}
```

and set `addon_labels: addonLabelsByWindow.get(w.id) ?? []` on each window passed to `RoomSummaryCard`. The card's window row type gains `addon_labels: string[]`, and each row renders them beneath the covering cell:

```tsx
{w.addon_labels.length > 0 && (
  <div className="text-[11px] text-slate-500">
    {w.addon_labels.join(" · ")}
  </div>
)}
```

Replace any use of `add_s_fold` / `add_slim_tracks` on this screen with that list.

- [ ] **Step 3: Verify in the browser**

Open an existing order's detail page. Confirm it renders and the COGS breakdown still balances.

- [ ] **Step 4: Commit**

```bash
git add src/components/orders/room-summary-card.tsx "src/app/(app)/orders/[orderId]/page.tsx"
git commit -m "feat(orders): show a window's add-ons by name"
```

---

### Task 22: Full verification

- [ ] **Step 1: The suite**

Run: `npm run test`
Expected: all pass. Anything referencing `add_s_fold`, `add_slim_tracks`, `curtain_type_id` or the `toilet` variant should have been *updated*, not deleted — each old assertion should survive in its new form.

- [ ] **Step 2: The build**

Run: `npm run build`
Expected: succeeds. This is the type check that finds every remaining reference to the three dropped columns.

- [ ] **Step 3: Confirm nothing survives**

```bash
grep -rn "add_s_fold\|add_slim_tracks\|CalcAddonBook" src/ --include="*.ts" --include="*.tsx" | grep -v "data/migrations"
grep -rn "variant: \"toilet\"\|'toilet'" src/ --include="*.ts" --include="*.tsx" | grep -v procurement
```

Expected: no output from either (the migrations keep their references, correctly).

- [ ] **Step 4: End-to-end, in the browser**

`npm run dev`, then work through the spec's §10 list. **The last two are the ones this change could break without anyone noticing.**

- [ ] A curtain order with no add-ons quotes **identically to before** — no silent re-pricing
- [ ] A toilet room offers blinds only, no covering toggle, and its quote uses the blinds install rate
- [ ] Price `extra_shipping` on the admin screen **first** — until it has a price the resolver keeps it off the form entirely, and testing the lock before that proves nothing. Then: measure a blind at 230 cm and confirm it appears, ticks itself, locks, and its figure lands in the quote
- [ ] Set the same blind to 195 cm and confirm the box unlocks and clears
- [ ] Tick Blackout on a curtain window; confirm the COGS breakdown grows a Blackout leg
- [ ] Save an order with add-ons, reopen the edit page, submit unchanged, confirm the add-ons **survive**
- [ ] Confirm that order is **not** flagged stale on the dashboard immediately after saving
- [ ] PO generation still produces correct documents for an existing `sent_to_vendor` order
- [ ] The manufacture reconciliation grid still loads for that same order

- [ ] **Step 5: Update the spec's status line**

In `docs/specs/phase-14-window-addons.md`, change the status to `implemented 2026-08-21`, and update the Phase 14 row in `docs/specs/README.md`.

- [ ] **Step 6: Commit**

```bash
git add docs/specs
git commit -m "docs(specs): mark phase 14 implemented"
```

---

## Notes for whoever executes this

**Do not "simplify" these while implementing.** Each was a bug found in review, and each looks like an unnecessary complication until it isn't:

- `selectedIds` and `persistedIds` are two parameters, not one. Merging them lets a crafted POST attach an archived add-on to a new window by asserting it was already there.
- The catalogue is loaded unfiltered. Adding `.where("is_active", "=", true)` to `loadAddonCatalogue` deletes archived-but-selected add-ons from every order on its next save.
- `rowToCalcWindow` takes its add-ons as an argument rather than reading a module-level map. That is what makes a forgotten call site a type error instead of a wrong number on the dashboard.
- The `orderBy` in `loadAddonCatalogue` is the only thing giving the checkboxes a stable order.
- The locked checkbox uses `pointer-events-none` + `tabIndex={-1}`, not `disabled`. React Hook Form drops disabled fields from submitted values.
- Add-on cost stays out of `curtainCostRmbCents` on both branches — that field is the air-freight base, not a total.
