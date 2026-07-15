# Phase 10 — Promotions & Combo bundle pricing

> Extends the pricing calculator (built on the Phase 9 foundation + live quote).
> Adds two independent pricing levers the consultant applies during a
> consultation: an **order-level promotion** (preset tier or custom %) and a
> per-window **combo** (a fixed bundle price that overrides the per-metre sale).
> Additive and non-destructive.

## Goal

Let admins define reusable **promotion tiers** (e.g. "CNY Sale −15%") and
**combos** (e.g. "Signature Set = Day Sheer + Night Signature → $450/window"),
and let consultants apply them on the consultation form so the **live quote,
Price quoted, deposit, and margin** all reflect them in real time — with the
margin-floor warning still honouring the active channel floor.

## Decisions (from brainstorming — flag if any are wrong)

- **Promotion = order-level.** Two ways to apply, both resolve to one discount %
  on the whole quote: (a) pick a **preset tier** (admin-managed list), or (b)
  enter a **custom %**. The discount reduces the **auto-filled Price quoted**;
  the live-quote margin already tracks the quoted price, so it recomputes for
  free. Groupbuy stays a separate informational line.
- **Combo = per-window, explicit pick** (not auto-match — consultant stays in
  control). A combo fixes that window's **sale** price; **cost stays** the real
  per-metre curtain COGS, so margin is genuine. The day/night curtain *type*
  pickers remain (they record what's actually made); the combo only overrides
  the price.
- **Combo + promo compose.** Combo sets a window's sale; the order-level promo
  discounts the resulting order total. Both can apply.
- **Money = integer cents; rates = integer basis points (×10000)**, per the
  existing pricing rules. No hard deletes — `is_active` archive.
- **Storage on the order:** the *applied* discount is denormalised onto the
  order (`discount_bps` + `promo_label`) so a saved order's quote is
  reproducible even if a tier is later edited/archived.

## Data model

New migration `data/migrations/YYYYMMDDHHMM_promotions_combos.ts` (Kysely, UTC
ts). Mirrors the `pricing_addons` / `curtain_series` RLS + trigger patterns.

```ts
// promotions — admin-managed discount tiers.
promotions(
  id uuid pk default gen_random_uuid(),
  name text not null,
  discount_bps integer not null,       // 15% → 1500
  is_active boolean not null default true,
  created_at/updated_at timestamptz
)
// unique index on lower(name); check (discount_bps between 0 and 10000)

// pricing_combos — admin-managed bundle prices.
pricing_combos(
  id uuid pk default gen_random_uuid(),
  name text not null,
  day_series_id uuid references curtain_series.id,     // nullable
  night_series_id uuid references curtain_series.id,   // nullable
  price_sgd_cents integer not null,                    // fixed bundle sale
  is_active boolean not null default true,
  created_at/updated_at timestamptz
)
// check (price_sgd_cents >= 0)

// orders — applied promotion (denormalised for reproducibility).
orders add:
  discount_bps integer not null default 0,   // applied discount
  promo_label text                            // e.g. "CNY Sale" (null = custom/none)

// windows — the explicitly-picked combo for this window.
windows add:
  combo_id uuid references pricing_combos.id  // nullable
```

RLS: authenticated read on all; admin insert/update (mirror `pricing_addons`).
No delete policy. `updated_at` triggers on `promotions` + `pricing_combos`.

After migrating: `npm run db:codegen`.

## Calculator (pure logic, TDD — `src/lib/pricing/calculator.ts`)

- **Combo override (window sale):** extend `CalcWindow` with
  `comboPriceSgdCents?: number | null`. In `windowQuote`, when set, the window's
  **sale** = `comboPriceSgdCents` (skip the day/night sale legs); **cost is
  unchanged** (still the per-metre curtain COGS + add-ons + track). Curtain-cost
  (air-freight base) and offering (installation) are unaffected.
- **Promotion (order sale):** `computeQuote` gains an optional
  `discountBps = 0`. After summing the order sale, the **discounted sale** =
  `round(sale × (10000 − discountBps) / 10000)`. Expose both `saleSgdCents`
  (pre-discount) and `discountedSaleSgdCents`; `marginBps` is computed against
  the discounted sale. Groupbuy is derived from the discounted sale.
- Tests: combo overrides only the sale (cost/COGS unchanged); discount reduces
  sale + margin; combo + discount compose; 0%/no-combo == today's result.

## Validation (`src/lib/validation/`)

- `promotionSchema`: `{ isNew, id?, name(1..120), discountPct (0..100), is_active? }`.
- `comboSchema`: `{ isNew, id?, name(1..120), day_series_id?, night_series_id?, price_sgd (decimal string), is_active? }`.
- Extend `orderMetaSchema`: `discount_bps` (int 0..10000, default 0),
  `promo_label` (optional string).
- Extend the regular-window schema: `combo_id` (optional uuid).

## Server actions

- `src/lib/actions/promotions.ts` — `upsertPromotion`, `togglePromotionActive`
  (admin; friendly duplicate-name error).
- `src/lib/actions/combos.ts` — `upsertCombo`, `toggleComboActive` (admin).
- Extend `upsertCurtainType`/order actions only where needed: the order
  create/update already persists `order.*`; add `discount_bps`, `promo_label`,
  and each window's `combo_id` to the insert/update mapping
  (`window-values.ts`).
- All actions start with `requireRole([...])` + Zod validation.

## UI

**Pricing Settings (`/admin/pricing-settings`)** — two new sections mirroring the
Add-ons list (single Save each, shadcn controls):
- **Promotions:** rows of `Name · Discount %` + archive.
- **Combos:** rows of `Name · Day series (shadcn select) · Night series (select)
  · Bundle price (S$)` + archive.

**Consultation form — Pricing & payment section:**
- **Promotion** control: a shadcn `Select` (None / preset tiers / "Custom %"). A
  preset sets its %; "Custom %" reveals a small % input. The applied discount
  recomputes the auto-filled **Price quoted** (`sale × (1 − discount)`) and 50%
  deposit; the live-quote margin (tracks quoted price) reflects it, with the
  channel floor warning.

**Consultation form — window (`window-fields.tsx`, regular variant only):**
- A **Combo** shadcn `Select` (None / active combos). Picking one stores
  `combo_id`; a badge shows `🏷 <name> — S$<price>/window (overrides calc)`. The
  day/night curtain pickers stay (record the actual fabrics). Toilet windows
  have no combo.

**Order detail (`quote-card.tsx`):** show the applied promo (name + %) and any
combo-priced windows in the read-only record.

**Live quote (`live-quote.tsx`):** already margin-tracks the quoted price; it
reads `discount_bps` (via the promo control) and each window's `combo_id`
(resolved to a price passed into `CalcWindow.comboPriceSgdCents`) so Sale / Cost
/ Margin update live as promos/combos change.

## Task order

1. Migration (`promotions`, `pricing_combos`, orders + windows columns) +
   `db:codegen`.
2. TDD: calculator combo-override + order discount; `promotionSchema`,
   `comboSchema`; order/window schema extensions.
3. Actions: `promotions.ts`, `combos.ts`; extend order + window persistence.
4. DB loaders: active promotions + combos for the form; combo price resolution
   in `order-quote.ts` (+ `loadCalcConfig`).
5. Admin UI: Promotions + Combos sections in Pricing Settings.
6. Consultation form: Promotion control (pricing section) + Combo select + badge
   (window fields); wire the live quote (discount + combo price).
7. Order detail: show applied promo + combo-priced windows.
8. Verify: `npm run build`, `npm run lint`, `vitest`; then a live consultation —
   apply a preset promo (price + margin drop, floor warning), a custom %, and a
   combo (window sale overrides, margin stays real), save, reopen (persists).

## Verification

- A preset promo tier applies its % → Price quoted + deposit + live margin drop;
  floor warning fires if it crosses the channel floor.
- A custom % behaves the same and persists (`discount_bps` on the order).
- A combo on a window fixes that window's **sale** to the bundle price while its
  **cost** stays the per-metre COGS (margin remains real); non-combo windows are
  unaffected.
- Combo + promo compose (combo sets window sale → promo discounts order total).
- Everything round-trips on edit; the order-detail card shows the applied promo
  + combo windows.
- Non-admin: promotion/combo actions rejected; RLS `is_admin()` denies writes.
- Deferred/untouched: blinds combos (blinds not built), auto-match combos
  (explicit pick only).
