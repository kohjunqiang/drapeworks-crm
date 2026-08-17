# Phase 12 — Product section & blinds

**Status:** spec only, not yet implemented
**Date:** 2026-08-16
**Depends on:** Phase 8/8b (curtain catalogue), Phase 9 (pricing foundation), Phase 10 (promotions & combos), Phase 11 (mesh)

---

## 1. Why

Two problems, one change.

**Navigation has fragmented.** Every product line added so far has bought itself a
top-level nav item. Admins now see `Digital Catalogue` and `Mesh` sitting side by side
with no indication that they are the same kind of thing — a catalogue of something we
sell. Adding blinds under the current scheme would make it three. This phase collapses
them into a single **Product** section with Curtain / Blinds / Mesh sub-areas.

**Blinds are half-present and entirely unusable.** Phase 11 called this out plainly:
blinds exist in the schema as two unused stubs — `pricing_assumptions.handyman_blinds_sgd_cents`
and the `by_sqm` value on the `pricing_calc_method` enum — and `calculator.ts` says
blinds are deferred. There is no blind catalogue, no way to put a blind on a window,
and no way to price one. This phase makes blinds a real, quotable product.

The two land together because the Product section is what gives blinds somewhere to live.

## 2. What a blind is, commercially

A blind is an alternative window covering to a curtain. It occupies the window
**instead of** curtains — a window is either a curtain window (day and/or night) or a
blind window, never both. An order may freely mix the two: a living room with curtains
and a study with blinds is one order, one quote, one customer.

Because blinds and curtains share the customer, the fulfilment process, the vendor
pipeline and the cost engine, blinds are **not** a separate order type. They sit inside
a curtain order. `orders.product_line` stays `curtain | mesh`; the "Curtains" card at
`/orders/new` is relabelled **Curtains & Blinds**.

### 2.1 Pricing decision — per width, not per area

The working Excel prices blinds by area (`Height × Width × CostPerM`) while curtains
price per metre of width. **We are deliberately not doing that.** Blinds price per metre
of width, exactly like a curtain leg.

This was an explicit product decision, taken with the consequence stated: a 3 m-tall
blind and a 1 m-tall blind on the same width quote identically. If blind margins later
come in wrong on tall windows, this is the first thing to revisit — the `by_sqm` value
on `pricing_calc_method` is still there, still inert, and is where an area-based
implementation would hook in.

### 2.2 What blinds do *not* inherit from curtains

| Curtain behaviour | Applies to blinds? | Why |
|---|---|---|
| Per-metre-of-width rate | **Yes** | §2.1 |
| `draw` direction | **Yes**, as control side | A blind has a chain/control side. Reuses the existing column, restricted to the two single values and relabelled — see §5. |
| Style multiplier on cost | No | The multiplier models gathered fabric fullness (~2× material). Blinds don't gather. |
| S-Fold / Slim Tracks add-ons | No | Curtain-specific hardware. |
| Track cost (single/double) | No | No `blinds_track` add-on is introduced. |
| Counts toward air-freight base | **Yes** | Blind COGS joins day+night COGS in the freight base. |
| Combo bundle price | No | `combo_id` lives on `regularWindow`, which a blind window is not. |
| Order-level promotion / discount | **Yes** | Applies to the order total, so blinds are covered automatically. |
| Install cost | **Yes**, its own rate | `handyman_blinds_sgd_cents`, which stops being dead code. |

## 3. Data model

One migration, `data/migrations/20260816120000_product_line_and_blinds.ts`. No new
tables — blinds reuse the entire curtain series/types machinery.

```sql
alter table curtain_series
  add column product_line text not null default 'curtain'
  check (product_line in ('curtain', 'blind'));

alter table windows
  add column blind_type_id uuid references curtain_types(id);

alter table curtain_types
  alter column category drop not null;
```

**Why `product_line` sits on the series, not the type.** Pricing already lives on the
series (Phase 9), and a series is bought from one vendor at one rate. A blind series
holds blind types exactly as a curtain series holds curtain types — same photo upload,
same archive semantics, same immutable-code rules, same admin dialogs. Putting the flag
on the type would allow a single series to hold both, which makes its single
cost/sale pair meaningless.

**Why `category` becomes nullable.** `curtain_types.category` is the Day/Night sheerness
taxonomy. It is meaningless for a blind. Rather than seed blinds with a lie (`'Day'`),
the column becomes nullable; validation requires it only for types in a curtain series
(§5). Existing rows are unaffected — they all have a value and keep it.

**RLS.** No new tables, so no new policies. `curtain_series`, `curtain_types` and
`windows` keep the policies they have.

**`down()`** drops the two added columns. It does **not** restore the `NOT NULL` on
`category`, because by then blind types with a null category may exist and the
constraint would fail. This is noted in the migration file itself.

After the migration: `npm run db:codegen`.

## 4. Admin — the Product section

### 4.1 Routes

| Route | Content |
|---|---|
| `/admin/product` | redirect → `/admin/product/curtains` |
| `/admin/product/curtains` | today's Digital Catalogue, filtered `product_line = 'curtain'` |
| `/admin/product/blinds` | same table + dialogs, filtered `product_line = 'blind'` |
| `/admin/product/mesh` | today's mesh page, moved unchanged |

`/admin/digital-catalogue` and `/admin/mesh` become **permanent redirects** to their new
homes. Existing bookmarks keep working, and so does the deep link from the mesh
not-sellable banner into pricing settings and back.

### 4.2 Shell

`src/app/(app)/admin/product/layout.tsx` renders the "Product" heading and a sub-tab bar
(Curtains / Blinds / Mesh). Each page underneath stays a Server Component running its
own queries — the shell is chrome only, so no catalogue loads data it isn't showing.

The Mesh tab keeps its own not-sellable-yet warning banner. That is mesh-specific
(priced grid cell + non-zero install cost), not section chrome, and does not move into
the layout.

### 4.3 Nav

`top-nav.tsx` and `mobile-menu.tsx` both drop their `Digital Catalogue` and `Mesh`
entries and gain one admin-only `Product` entry matching `/admin/product`:

```
Orders │ New Consultation │ Product │ Vendors │ Pricing
```

Both files currently carry near-duplicate link arrays. Extract the shared list to one
module (`src/components/nav/links.ts`) rather than making the same edit twice — the
duplication is what would let the two menus drift apart on the next product line.

### 4.4 Catalogue pages

The Curtains and Blinds pages are the **same components** parameterised by product line:

- `CurtainTypesTable`, `CurtainTypeFormDialog` and `CurtainSeriesDialog` take a
  `productLine: 'curtain' | 'blind'` prop.
- `loadSeriesForCatalogue()` takes a product-line argument and filters on it.
- On the Blinds tab the Day/Night category field is **hidden** and submitted as null;
  on the Curtains tab it is required, as today. The category **badge column and the
  category filter dropdown** are hidden on the Blinds tab too — otherwise both would
  render permanently blank.
- Blinds get **no replacement taxonomy**. The blind family (Zebra, Roller, Roman…) is
  carried by the series name, e.g. a series called `Zebra — Ivory Range`. If filtering
  by family is wanted later, it should be a real column, not a reuse of `category`.
- Copy adapts: "curtain type" → "blind" in headings, empty states and button labels.

**Series creation.** The active tab sets `product_line` on a new series — there is no
visible field. It is **not editable afterwards**: moving a series between lines would
silently change how every window referencing it is priced and installed.

## 5. Validation

`src/lib/validation/curtain-series.ts` gains `product_line: z.enum(['curtain','blind'])`,
defaulted to `'curtain'` and accepted only on create.

`src/lib/validation/curtain-type.ts`: `category` becomes optional at the schema level,
with the server action requiring it when the target series is a curtain series and
rejecting it when the series is a blind series. The check belongs on the server because
it depends on the series row, which the client form does not authoritatively hold.

`src/lib/validation/order.ts` gains a third member of the window discriminated union:

```ts
// A blind's chain/control side. "Double" is a curtain concept (two leaves
// meeting in the middle) and is not offered.
const BLIND_CONTROL_SIDES = ["Single Left", "Single Right"] as const;

const blindWindow = baseWindow.extend({
  variant: z.literal("blind"),
  blind_type_id: optionalTypeId,
  draw: z.enum(BLIND_CONTROL_SIDES).optional(),
});

export const windowSchema = z.discriminatedUnion("variant", [
  regularWindow,
  toiletWindow,
  blindWindow,
]);
```

This is what enforces "curtains or blinds, never both". A blind window has no
`day_curtain_type_id` field to set, so the rule holds at the type level rather than as a
runtime guard that someone can forget to call. The same addition is made to the draft
and edit variants (`windowEditSchema`, and the relaxed draft schema's `variant` enum).

**One `blind` variant covers both room types.** The `toilet` variant exists because a
toilet window takes *one* covering instead of a day/night pair. A blind window is
already one covering, so it needs no toilet-specific counterpart — a blind in a Master
Toilet and a blind in a Living Room are the same shape. Blinds are therefore allowed in
every room type, and no fourth variant is introduced.

### 5.1 The variant ↔ room-type guard must change

`src/lib/actions/orders.ts` currently *derives* the window shape from the room type in
three places, and all three reject or destroy a blind window as written:

| Location | Today | Must become |
|---|---|---|
| `createOrder` (~L95) | throws unless `isToilet ? 'toilet' : 'regular'` | `blind` is valid in **any** room; otherwise the existing match still applies |
| `updateOrder` (~L219) | same throw | same change |
| `saveDraft` (~L445) | **overwrites** `variant` with the room-derived value | preserve `variant` when it is `blind`; derive only between `regular` and `toilet` |

The `saveDraft` case is the dangerous one: as written it would silently convert a
half-filled blind window into a curtain window on every autosave, discarding
`blind_type_id`. It must be fixed in the same commit as the schema change, not later.

`src/lib/orders/window-values.ts` widens its `variant` union to include `blind` and
nulls the opposite variants' columns — `blind_type_id` on curtain windows,
`day/night/curtain_type_id` plus `add_s_fold`, `add_slim_tracks` and `combo_id` on blind
windows. Keeping every branch explicitly null is what stops a variant switch from
leaving stale ids behind.

## 6. Consultation form

### 6.1 The toggle

Each window card gains a `Curtains | Blinds` segmented toggle at the top:

```
Room: Living Room
 ┌─ Window 1 ──────────────────────────┐
 │ [ Curtains ]  Blinds                │
 │ Width   Height   Install width      │
 │ Day   [Vero Sheer            ▾]     │
 │ Night [Vero Blackout         ▾]     │
 │ ☐ S-Fold   ☐ Slim Tracks            │
 └─────────────────────────────────────┘
 ┌─ Window 2 ──────────────────────────┐
 │   Curtains  [ Blinds ]              │
 │ Width   Height   Install width      │
 │ Blind [Zebra Blind — Ivory   ▾]     │
 │ Control side  ( ) Left  (•) Right   │
 └─────────────────────────────────────┘
```

Switching to Blinds clears `day_curtain_type_id`, `night_curtain_type_id`,
`curtain_type_id`, `add_s_fold`, `add_slim_tracks` and `combo_id`. Switching back clears
`blind_type_id`. Measurements (`width_cm`, `height_cm`, `install_width_cm`) and `notes`
survive the switch — they describe the opening, not the covering.

`draw` also survives, but is **relabelled "Control side"** and offers only Left / Right
(a blind has no `Double`). If a curtain window on `Double` is switched to Blinds, `draw`
is cleared rather than silently coerced.

The toggle appears on **every window, including toilet-room windows** — a blind in a
toilet is the same shape as a blind anywhere else (§5). A toilet window on Curtains
keeps its single curtain select; on Blinds it looks identical to the card above.

### 6.2 Option loading

`loadActiveCurtainTypeOptions()` returns the series' `product_line` alongside each
option, and the form filters:

- Day / Night selects → `product_line = 'curtain'` only
- Blind select → `product_line = 'blind'` only

So a blind can never be picked into a day slot, independent of the toggle.

### 6.3 Product chooser

`ProductLineChooser` relabels its first card to **Curtains & Blinds**, with a blurb
covering both. The Mesh card and its sellable gate are untouched.

## 7. Pricing

`src/lib/pricing/calculator.ts`:

```ts
export type CalcWindow = {
  widthCm: number | null;
  dayPrice?: SeriesPrice | null;
  nightPrice?: SeriesPrice | null;
  blindPrice?: SeriesPrice | null;   // new
  addSFold: boolean;
  addSlimTracks: boolean;
  comboPriceSgdCents?: number | null;
};

export type Offering = "none" | "single" | "double" | "blind";   // "blind" added
```

A blind window's leg, in `windowQuote`:

```
cost = round((width_cm / 100) × blindPrice.costRmbCents)     // no style multiplier
sale = round((width_cm / 100) × blindPrice.saleSgdCents)
```

with no add-on legs and no track leg. Its cost joins the air-freight base (the value
returned today as `curtainCostRmbCents`, which becomes the freight base for day + night
+ blind).

`installFor` gains the blind branch:

```
blind window       → handymanBlindsSgdCents
day + night        → handymanDoubleSgdCents
day or night only  → handymanSingleSgdCents
nothing measured   → 0
```

A window counts as a blind window for install purposes when it has a `blindPrice` and a
positive width — the same "measured" test day/night already use, so install cost never
changes because an admin edited a rate.

`src/lib/pricing/order-quote.ts` loads blind series prices into the same price book and
passes `handymanBlindsSgdCents` through from `pricing_assumptions`.

## 8. Surfaces to update

Each needs to render a blind line where it renders Day/Night rows today:

- `consultation-form/live-quote.tsx` and `use-quote-autofill.ts`
- `consultation-form/window-fields.tsx`
- `consultation-form/room-card.tsx` — its room-type-change effect (~L52) rewrites every
  window's variant, the client-side twin of the `saveDraft` bug in §5.1. It must skip
  windows already set to `blind`.
- `quote-card.tsx`
- `room-summary-card.tsx`
- `room-edit-card.tsx`
- order detail page
- order edit form
- print view

## 9. Tests

Following the `mesh-calculator.test.ts` pattern:

- blind leg maths — width × rate, cost with **no** style multiplier applied
- install-cost selection across all four window shapes (blind, day-only, night-only,
  day+night) and the unmeasured case
- blind COGS is included in the air-freight base
- a blind window contributes no add-on and no track cost even when `addSFold` /
  `addSlimTracks` are true
- schema-level: a window cannot carry both `blind_type_id` and a day/night type
- order-level promotion discount applies to a mixed curtain + blind order
- `loadActiveCurtainTypeOptions` filtering by product line
- a blind window is accepted in a toilet room **and** in a regular room (§5.1)
- `saveDraft` preserves a `blind` variant instead of coercing it from the room type —
  the regression that would otherwise silently drop `blind_type_id` on autosave
- `windowValues` nulls the opposite variant's columns in all three directions
  (regular → blind, toilet → blind, blind → regular)
- `draw` on a blind rejects `Double` and accepts Left / Right

## 10. Rollout

1. Migration + `db:codegen`
2. Validation schemas + tests
3. Calculator + tests
4. Admin Product section (routes, layout, nav, redirects, parameterised catalogue)
5. Consultation form (toggle, option filtering, chooser relabel)
6. Read surfaces (§8)
7. Seed the first blind series through the admin UI, end-to-end quote check

Steps 1–4 are shippable without step 5: blinds are manageable in admin and simply not
yet offered on consultations. That is a safe intermediate state.

## 11. Out of scope

- Area-based (`by_sqm`) blind pricing — see §2.1
- A `blinds_track` add-on
- Combos on blind windows
- A blind-family taxonomy column (Zebra / Roller / Roman) — series name carries it, §4.4
- Removing the now-inert `pricing_calc_method` enum
- Any change to mesh beyond moving its route
