# Phase 9 — Pricing foundation: **vendors** + **cost/sale data**

> First slice of the pricing strategy. Introduces the **vendor** concept, attaches
> a **vendor + cost (RMB) + curated sale price (SGD)** to each curtain type, and
> stores the global **pricing assumptions** and **add-on** price list. **Data +
> admin UI only** — no live calculator yet (that's Phase 10). Additive and
> non-destructive.
>
> Source of truth for the numbers: `~/Downloads/Drape Works - Business System.xlsx`
> (`Vendor Cost Price`, `Pricing Chart`, `Assumptions` sheets). See the
> `pricing-excel-model` memory for the full reverse-engineered engine.

## Goal

Let admins record **which vendor supplies each curtain** and at **what cost**,
plus the **price we sell it at** — so the app "knows the curtain that belongs to a
particular vendor." This is the reference data the Phase-10 calculator will read
to compute a quote and its margin. No order math changes in this phase.

## Decisions (from brainstorming — flag if any are wrong)

- **One chosen vendor per curtain** (1:1). The Excel lists alternative vendors per
  product, but live pricing uses a single chosen vendor. Modelled as a
  `vendor_id` + cost columns **directly on `curtain_types`**, not a join table.
  Revisit only if multi-vendor sourcing becomes a real need.
- **Sale price is a curated fixed list** (SGD/metre), maintained by hand like the
  `Pricing Chart` "Simplified Pricing" column — **not** derived from cost × markup.
  Markup is a display-only reference the calculator can show later.
- **Money = integer cents** (per project rule), for **both** RMB cost and SGD sale.
  e.g. `5100` = ¥51.00/m, `9000` = S$90.00/m.
- **Rates & multipliers = integer, scaled ×10000** (so ratio `1.0` = `10000`).
  GST 9% = `0.09` → `900`; FX 5.3 → `53000`; style multiplier 2.0 → `20000`;
  premium 1.15 → `11500`. Every rate/multiplier field uses this ×10000 scale
  regardless of whether its name carries the `_bps` suffix. Keeps everything
  integer, no floats.
- **`calc_method`** (`by_width` | `by_sqm`) stored on the curtain type. Day/Night
  curtains are all `by_width`; the column exists so **blinds** (by SQM) can join
  later with no migration. Blinds themselves are **out of scope** this phase —
  `curtain_types` is Day/Night only today.
- **Add-ons** (Blackout, S-Fold, Slim Tracks, Single/Double Track, Blinds
  Surcharge) live in their own small `pricing_addons` table — they're priced items
  the calculator needs but aren't curtains.
- **Assumptions = single-row settings table**, edited on a settings screen.
- **Conflicts to resolve during data seed (do not guess):** the Excel has
  inconsistent vendor IDs (`V002` = both Zhao *and* Rongxin; `V003` = both Rongxin
  *and* FengHua) and **two FX rates** (5.3 vs 5.25). Surface these to the user and
  seed one authoritative vendor list + one FX.

## Data model

New migration `data/migrations/YYYYMMDDHHMM_pricing_foundation.ts` (Kysely, UTC ts).
Mirror the `curtain_series` / `curtain_types` RLS + trigger patterns.

```ts
// pricing_calc_method enum
await sql`create type pricing_calc_method as enum ('by_width','by_sqm')`.execute(db);
// addon_basis enum
await sql`create type pricing_addon_basis as enum ('per_metre','per_unit')`.execute(db);

// vendors
await db.schema.createTable("vendors")
  .addColumn("id", "uuid", c => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
  .addColumn("code", "text", c => c.notNull())          // 'V001'… (authoritative)
  .addColumn("name", "text", c => c.notNull())
  .addColumn("is_active", "boolean", c => c.notNull().defaultTo(true))
  .addColumn("notes", "text")
  .addColumn("created_by", "uuid", c => c.references("profiles.id"))
  .addColumn("created_at", "timestamptz", c => c.notNull().defaultTo(sql`now()`))
  .addColumn("updated_at", "timestamptz", c => c.notNull().defaultTo(sql`now()`))
  .execute();
await sql`create unique index vendors_code_unique on public.vendors (lower(code))`.execute(db);

// curtain_types pricing additions (additive, nullable)
await db.schema.alterTable("curtain_types")
  .addColumn("vendor_id", "uuid", c => c.references("vendors.id"))
  .addColumn("cost_rmb_cents", "integer")   // vendor cost per metre, cents of RMB
  .addColumn("sale_sgd_cents", "integer")   // curated sale price per metre, cents of SGD
  .addColumn("calc_method", sql`pricing_calc_method`, c => c.notNull().defaultTo("by_width"))
  .execute();
await sql`alter table public.curtain_types
          add constraint curtain_types_cost_nonneg check (cost_rmb_cents is null or cost_rmb_cents >= 0),
          add constraint curtain_types_sale_nonneg check (sale_sgd_cents is null or sale_sgd_cents >= 0)`.execute(db);

// pricing_addons
await db.schema.createTable("pricing_addons")
  .addColumn("id", "uuid", c => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
  .addColumn("key", "text", c => c.notNull())           // 'blackout','s_fold','slim_tracks','single_track','double_track','blinds_surcharge'
  .addColumn("label", "text", c => c.notNull())
  .addColumn("cost_rmb_cents", "integer")
  .addColumn("sale_sgd_cents", "integer")
  .addColumn("basis", sql`pricing_addon_basis`, c => c.notNull().defaultTo("per_metre"))
  .addColumn("is_active", "boolean", c => c.notNull().defaultTo(true))
  .addColumn("created_at", "timestamptz", c => c.notNull().defaultTo(sql`now()`))
  .addColumn("updated_at", "timestamptz", c => c.notNull().defaultTo(sql`now()`))
  .execute();
await sql`create unique index pricing_addons_key_unique on public.pricing_addons (key)`.execute(db);

// pricing_assumptions — single row (id=true guard)
await db.schema.createTable("pricing_assumptions")
  .addColumn("singleton", "boolean", c => c.primaryKey().defaultTo(true).check(sql`singleton`))
  .addColumn("fx_sgd_to_rmb", "integer", c => c.notNull())          // ×10000 (5.3 → 53000)
  .addColumn("gst_bps", "integer", c => c.notNull())                // ×10000 (0.09 → 900)
  .addColumn("other_cost_bps", "integer", c => c.notNull())         // 0.10 → 1000
  .addColumn("premium_bps", "integer", c => c.notNull())            // 1.15 → 11500
  .addColumn("groupbuy_discount_bps", "integer", c => c.notNull())  // 0.15 → 1500
  .addColumn("style_multiplier", "integer", c => c.notNull())       // 2.0 → 20000
  .addColumn("handyman_sgd_cents", "integer", c => c.notNull())     // $100 → 10000
  .addColumn("sea_freight_rmb_cents_per_m3", "integer", c => c.notNull()) // ¥400 → 40000
  .addColumn("air_freight_rate_bps", "integer", c => c.notNull())   // 0.6 → 6000
  .addColumn("air_freight_floor_rmb_cents", "integer", c => c.notNull())  // ¥500 → 50000
  .addColumn("air_freight_cap_rmb_cents", "integer", c => c.notNull())    // ¥1400 → 140000
  .addColumn("min_margin_bps", "integer", c => c.notNull())         // 0.35 → 3500
  .addColumn("min_margin_carousell_bps", "integer", c => c.notNull()) // 0.30 → 3000
  .addColumn("updated_at", "timestamptz", c => c.notNull().defaultTo(sql`now()`))
  .execute();
```

RLS (mirror `curtain_types`): authenticated **read** on all four objects; **admin**
insert/update. No delete policy — archive via `is_active` (`vendors`,
`pricing_addons`); `pricing_assumptions` is edit-only. `updated_at` trigger
(reuse `public.set_updated_at`) on vendors / pricing_addons / pricing_assumptions.

`down()`: drop curtain_types columns + check constraints, drop the three new
tables, drop the two enums.

After migrating: `npm run db:codegen`.

## Pure logic (TDD)

- `bpsToRatio(bps)` / `ratioToBps(n)` and `formatRmb(cents)` / `formatSgd(cents)`
  display helpers (extend `money.ts`; SGD formatting already exists).
- `vendorSchema`: `{ isNew, id?, code(1..20), name(1..120), is_active?, notes? }`.
- `curtainTypeSchema` (extend): `vendor_id` optional uuid; `cost_rmb_cents`,
  `sale_sgd_cents` optional non-negative ints; `calc_method` enum default
  `by_width`.
- `pricingAssumptionsSchema`: all integer fields, non-negative, sane upper bounds.
- `pricingAddonSchema`: `{ id?, key, label, cost_rmb_cents?, sale_sgd_cents?, basis, is_active? }`.

## Server actions

- `src/lib/actions/vendors.ts` — `upsertVendor(input)`, `toggleVendorActive(id)`
  (admin; friendly "vendor code already exists" on the unique violation).
- extend `src/lib/actions/curtain-types.ts` — `upsertCurtainType` accepts the new
  pricing fields (validate + persist alongside existing catalogue save).
- `src/lib/actions/pricing-settings.ts` — `updatePricingAssumptions(input)`
  (admin; upsert the singleton row), `upsertPricingAddon`,
  `togglePricingAddonActive`.
- Every action starts with `await requireRole(['admin'])` and Zod-validates.

## UI

No prototype exists for pricing — mirror the existing admin dialog/table patterns
(`fabrics`, `curtain-series-dialog`, curtain-type form). Teal accent, same shadcn
primitives.

- **`/admin/vendors`** — vendors table (code, name, active) + add/edit dialog +
  active toggle. Add nav link under the admin area.
- **Curtain-type form dialog** (`/admin/digital-catalogue`) — add a **Pricing**
  section: Vendor dropdown (active vendors), Cost (RMB/m) input, Sale price
  (SGD/m) input, calc-method select (default By width). Show implied margin
  read-only as a helper once both cost + sale are entered.
- **`/admin/pricing-settings`** — assumptions form (grouped: FX & tax, freight,
  margins, defaults) + an add-ons table with inline edit. Inputs accept
  human-friendly decimals/percentages; convert to the integer storage scale in the
  action.

## Task order

1. Migration + `db:codegen`.
2. TDD: money/bps helpers, `vendorSchema`, curtain-type pricing fields,
   `pricingAssumptionsSchema`, `pricingAddonSchema`.
3. Actions: `vendors.ts`; extend `upsertCurtainType`; `pricing-settings.ts`.
4. Admin UI: vendors page + dialog; extend curtain-type form; pricing-settings
   page (assumptions + add-ons).
5. **Data seed** (separate reviewable step): confirm the flagged vendor-ID / FX
   conflicts with the user, then load the authoritative vendor list, attach
   cost/sale to existing curtain types, and seed assumptions + add-ons from the
   Excel (via the `DATABASE_URL` script pattern used for the curtain catalog).
6. Verify: `npm run build`, `npm run lint`, `vitest`; then live Playwright check.

## Verification

- Admin can create/edit a vendor; duplicate code is rejected with a friendly error.
- A curtain type can be assigned a vendor + cost + sale price; the form shows the
  implied margin; values round-trip as integer cents.
- Assumptions screen persists the singleton row; decimals/percentages convert to
  the ×10000 / cents storage scale and back correctly.
- Add-ons list edits and archives (no hard delete).
- Non-admin: all new actions rejected; RLS `is_admin()` denies writes; reads work.
- Existing catalogue, consultation, and order flows are unchanged (additive only).
```
