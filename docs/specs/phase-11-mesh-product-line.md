# Phase 11 — Mesh product line

**Status:** spec only, not yet implemented
**Date:** 2026-08-05
**Depends on:** Phase 9 (pricing foundation), Phase 10 (promotions & combos)

---

## 1. Why

Drapeworks is launching **Mesh** — window insect/security mesh — as a second product
line alongside curtains. The CRM today models exactly one product: a curtain window
with a day type, a night type, a draw direction and per-metre pricing. Mesh shares
none of those attributes and none of that pricing maths, but shares the customer, the
fulfilment process and the cost pipeline.

Note that "blinds" is **not** an existing second product line despite appearing in the
schema. It exists only as two unused stubs: `pricing_assumptions.handyman_blinds_sgd_cents`
and the `by_sqm` value on the `pricing_calc_method` enum. `calculator.ts` states
plainly that blinds are deferred. Mesh is therefore the **first** real second product
line, and the structure chosen here is the pattern blinds will follow later.

## 2. The product

Window mesh, installed by a handyman who drills the frame and seals it with silicone
gel. Three grades:

| Category | Purpose |
|---|---|
| **AirGuard** | Insect mesh |
| **PetGuard** | Pet-resistant mesh |
| **MaxGuard** | Child-safety / child-locked mesh |

Recorded per panel: category, colour, width, height, depth, draw configuration, and —
for a double draw — the left/right leaf split.

**Depth** is a site measurement of the window recess (how deep the reveal is, i.e.
whether there is room to install into the opening). It is measured in cm alongside
width and height. It is *not* a chosen product spec and it does *not* affect price.

**Draw** is one of five directions: `Single Left`, `Single Right`, `Single Top`,
`Single Bottom`, `Double`. A double draw splits the opening into two sliding leaves.
The split is recorded as two cm measurements (left leaf width, right leaf width)
rather than a preset ratio list, so any split is expressible — 50/50, ⅓/⅔, ¼/¾, or
anything else the site requires. The factory receives exact numbers. Double draw is
always horizontal; there is no top/bottom split.

## 3. Commercial rules

Established during design; these are decisions, not assumptions.

| Question | Decision |
|---|---|
| Can one order contain both curtains and mesh? | **No.** A mesh job never shares a quote with a curtain job. |
| Pricing basis | **Flat price per panel**, not per m² and not per metre. |
| What varies the price | **Category** and **size band** and **colour**. Draw does *not* affect price. |
| Size band definition | **By area (m²)** — width × height decides the band. |
| Supply chain | **Same China pipeline as curtains** — RMB cost → freight + other cost + GST → FX → SGD. |
| Fulfilment | **Same six statuses**, unchanged. |
| Installation | **A cost, not a customer line item** — reduces margin, never appears on the quote. |
| Promotions | **Same promotion tiers and custom %** as curtain orders. |
| Grouping | **Rooms**, same as curtains. A room may hold multiple mesh openings. |
| Colours | **One global colour list** shared by all three categories. |
| Photo catalogue | **None.** Three categories is a plain dropdown. |

## 4. Architecture decision

**Shared order shell, separate line-item table.**

`orders` gains a `product_line` discriminator. Rooms stay shared. Mesh openings live
in a new `mesh_panels` table hanging off `room_id`, with its own columns, its own Zod
schema, its own calculator module and its own form field component. Customers, order
numbering, the dashboard, the six statuses, promotions and the pricing assumptions are
all reused unchanged.

### Alternatives rejected

**One `windows` table with nullable mesh columns.** Fewer moving parts, but `windows`
becomes a sparse table where half the columns are always null for any given row, and
every existing curtain query, the pricing calculator, the print view and the quote card
would start receiving rows they were never written for — with nothing in the type system
preventing it. Rejected because the cost lands on working, revenue-generating code.

**Fully separate silo** (`mesh_orders` / `mesh_rooms` / `mesh_panels`, separate routes,
separate numbering). Total isolation, but it duplicates the status machine, the
promotions UI, the pricing-assumptions page, the order-numbering counter and the
dashboard — all of which the commercial rules above say mesh *shares*. Rejected as
paying for isolation that the chosen approach already provides.

## 5. Data model

One migration, `data/migrations/<YYYYMMDDHHMM>_mesh_product_line.ts`. Additive only;
no existing column changes type and no existing row needs data surgery.

### 5.1 Discriminator

```sql
create type product_line as enum ('curtain', 'mesh');
alter table public.orders
  add column product_line product_line not null default 'curtain';
```

The default backfills every existing order as a curtain order.

### 5.2 Draw enum

```sql
create type mesh_draw_direction as enum (
  'Single Left', 'Single Right', 'Single Top', 'Single Bottom', 'Double'
);
```

A new type rather than extending the existing `draw_direction`, which would otherwise
gain `Single Top` / `Single Bottom` values that are meaningless for curtains.

### 5.3 Catalogue tables

All three follow the `vendors` pattern: uuid PK, `is_active` soft-archive flag (no hard
deletes), `created_by` → `profiles.id`, `created_at` / `updated_at` timestamptz with the
`set_updated_at` trigger.

```
mesh_categories
  id            uuid pk
  name          text not null          -- "AirGuard" / "PetGuard" / "MaxGuard"
  description   text
  vendor_id     uuid references vendors(id)
  position      int not null default 0
  is_active     boolean not null default true
  created_by, created_at, updated_at

  unique index on lower(name)

mesh_colours
  id                    uuid pk
  name                  text not null
  surcharge_rmb_cents   int                -- nullable; null = no surcharge
  surcharge_sgd_cents   int
  position              int not null default 0
  is_active             boolean not null default true
  created_by, created_at, updated_at

  unique index on lower(name)

mesh_size_bands
  id             uuid pk
  label          text not null            -- "Up to 2 m²"
  max_area_cm2   int                      -- null = open-ended top band
  position       int not null default 0
  is_active      boolean not null default true
  created_at, updated_at
```

Area is stored in **cm²** as an integer (`width_cm × height_cm`), so band matching is
integer arithmetic with no float drift — the same discipline as money-in-cents. 2 m²
is `20000`.

Bands must be ordered ascending by `max_area_cm2`, with the open-ended band
(`max_area_cm2 IS NULL`) last. The admin UI derives `position` from that ordering
rather than letting it be set freely, so the lookup in §6.1 cannot pick a wrong band.

Colour surcharges are **flat per panel**, matching the flat-per-panel pricing basis.
They are not scaled by area.

Category and colour names are stored **verbatim as typed** — no prefix stripping, no
typo correction — consistent with how the curtain catalogue treats labels.

### 5.4 Price book

```
mesh_prices
  id              uuid pk
  category_id     uuid not null references mesh_categories(id)
  band_id         uuid not null references mesh_size_bands(id)
  cost_rmb_cents  int                     -- nullable = not yet priced
  sale_sgd_cents  int
  created_at, updated_at

  unique (category_id, band_id)
```

Three categories × three bands = a nine-cell grid, edited in the admin UI.

### 5.5 Line item

```
mesh_panels
  id              uuid pk
  room_id         uuid not null references rooms(id) on delete cascade
  position        int not null
  category_id     uuid references mesh_categories(id)
  colour_id       uuid references mesh_colours(id)
  width_cm        int
  height_cm       int
  depth_cm        int
  draw            mesh_draw_direction
  split_left_cm   int
  split_right_cm  int
  notes           text
  created_at

  index on room_id
```

All product columns are nullable so a draft consultation can be saved half-finished,
matching the existing `windows` behaviour.

### 5.6 Assumption column

```sql
alter table public.pricing_assumptions
  add column handyman_mesh_sgd_cents int not null default 0;
```

### 5.7 RLS

- `mesh_categories`, `mesh_colours`, `mesh_size_bands`, `mesh_prices` — mirror
  `vendors` exactly: authenticated select, admin insert, admin update, no delete.
- `mesh_panels` — mirror `windows` exactly: authenticated select; for-all write
  permitted where the owning order's `consultant_id = auth.uid()` or `is_admin()`,
  joined through `rooms`.

After the migration, run `npm run db:codegen`.

## 6. Pricing

Mesh reuses the entire back half of the existing engine. Only the per-line-item front
end differs.

| | Curtain | Mesh |
|---|---|---|
| Front end | width × per-metre rate × style multiplier, + S-fold / slim-track add-ons, + track cost | `(category, band)` base + colour surcharge |
| Freight base | curtain-only COGS (excludes add-ons and tracks) | full panel COGS |
| Back half | freight → other cost → GST → FX → install → discount → margin → groupbuy | identical |

### 6.1 Panel quote

```
area_cm2 = width_cm × height_cm
band     = first band, ordered by position, where
             max_area_cm2 IS NULL OR area_cm2 ≤ max_area_cm2
price    = mesh_prices[category_id][band_id]
cost     = price.cost_rmb_cents  + (colour.surcharge_rmb_cents ?? 0)
sale     = price.sale_sgd_cents  + (colour.surcharge_sgd_cents ?? 0)
```

A panel with a null width or height, no category, or no matching `mesh_prices` row
contributes zero and is reported as unpriced (see §9).

### 6.2 Shared tail

Extract the common back half out of `src/lib/pricing/calculator.ts` into a function both
calculators call:

```ts
finaliseQuote(
  { cogsRmbCents, freightBaseRmbCents, saleSgdCents, installSgdCents },
  assumptions, freightMode, extraInstallSgdCents, discountBps
): QuoteResult
```

The freight base is a parameter because the two products bill freight on different
bases (see table above). Everything downstream — air freight clamped to floor/cap or
flat sea freight, other cost, GST, RMB→SGD at the FX rate, install added as an SGD
cost, the promotion discount applied to the sale, then `marginBps` and groupbuy — is
common and moves wholesale into `finaliseQuote`.

`QuoteResult` is unchanged. `computeQuote` becomes a thin curtain-specific front end
that calls `finaliseQuote`. **The existing 67 tests must pass unchanged after this
refactor** — that is the safety gate for the whole phase.

### 6.3 Mesh calculator

New module `src/lib/pricing/mesh-calculator.ts`:

```ts
panelQuote(panel, priceBook, colour): { costRmbCents, saleSgdCents }
computeMeshQuote(panels, priceBook, assumptions, freightMode,
                 extraInstallSgdCents, discountBps): QuoteResult
```

Install is `panels.length × handymanMeshSgdCents + extraInstallSgdCents` — a cost that
lowers margin and never appears on the customer quote.

S-fold, slim tracks, track cost and combos do not exist for mesh. The freight mode and
sales channel selectors work unchanged.

### 6.4 Order quote

`src/lib/pricing/order-quote.ts` branches once at the top on `order.product_line`:
mesh orders load panels plus the mesh price book and call `computeMeshQuote`; curtain
orders take the existing path untouched. `price_calc_at_quote_cents` and the
stale-quote banner keep working as-is, since they only ever store a single total.

## 7. Validation

New module `src/lib/validation/mesh.ts`.

`src/lib/validation/order.ts` stays byte-identical except that `customerSchema` and
`orderMetaSchema` become exported so they can be reused. `orderMetaSchema` gains
`product_line: z.enum(["curtain","mesh"]).default("curtain")`.

```ts
meshPanelSchema        // position, category_id, colour_id, width/height/depth_cm,
                       // draw, split_left_cm, split_right_cm, notes
meshRoomSchema         // type, label, position, panels[]
meshOrderCreateSchema  // { customer, order, rooms }
meshOrderDraftSchema   // relaxed, mirrors orderDraftSchema
meshOrderEditSchema    // panels carry an optional id for upsert
```

Measurements reuse the existing `optionalInt` preprocessor and the 1000 cm cap.

**Split validation:** `split_left_cm + split_right_cm` should equal `width_cm`, but a
mismatch is a **warning, not a validation error**. A consultant must never be blocked
by a 1 cm discrepancy on site. The form shows an amber hint; the schema accepts the
values. The split fields are only meaningful when `draw = 'Double'`.

## 8. UI

### 8.1 Entry point

`/orders/new` renders a two-card chooser (Curtains / Mesh) when no product is selected,
then the form for the chosen line. No new top-nav item — the nav is already five items
deep and the mobile menu is tight.

The Mesh card is hidden until at least one `mesh_prices` row has a `sale_sgd_cents`, so
nobody can create a $0 mesh quote before the catalogue is configured.

### 8.2 Consultation form

Thread a `productLine` prop through `ConsultationForm` and `RoomCard` and swap only the
innermost field component:

```
ConsultationForm  ──┬── CustomerSection        shared
                    ├── RoomCard               shared (rooms, photos, add/remove)
                    │     ├── WindowFields     curtain
                    │     └── MeshPanelFields  new
                    ├── PricingSection         shared (promo, freight, channel)
                    └── LiveQuote              branches on productLine
```

`MeshPanelFields` is one new component: category select, colour select, width / height /
depth in cm, draw select, and — revealed only when draw is `Double` — the left/right cm
pair with a live sum check against total width.

This threads a prop through two curtain files rather than duplicating the room, photo
and customer scaffolding. Follow the existing prototype classes and breakpoints
(`docs/prototype/consultation.html`).

### 8.3 Orders list and detail

- `orders-filters.tsx` gains a product-line filter; `orders-table.tsx` and
  `orders-cards.tsx` gain a product-line badge per row.
- `room-summary-card.tsx` / `room-edit-card.tsx` render a panel spec table for mesh
  orders: category, colour, W × H × D, draw, and the split.
- The print view renders the same panel spec table.

### 8.4 Admin

New page `/admin/mesh`, admin-only, following the `/admin/vendors` pattern (server
components + shadcn dialogs + server actions in `src/lib/actions/mesh-catalogue.ts`).
Three sections:

1. **Categories** — name, description, vendor, active toggle
2. **Colours** — name, RMB and SGD surcharge, active toggle
3. **Size bands & prices** — band list (label + max m²) plus the category × band price
   grid, RMB cost and SGD sale per cell

Empty state prompts the admin to add the first category, the same way the vendors page
does.

`/admin/pricing-settings` gains the single `handyman_mesh_sgd_cents` field in
`assumptions-form.tsx`.

### 8.5 Server actions

New module `src/lib/actions/mesh-orders.ts` — `createMeshOrder`, `updateMeshOrder`,
`saveMeshDraft`. Order-numbering and customer-upsert helpers are lifted out of
`orders.ts` into a shared module and reused. Every action opens with
`await requireRole([...])` and validates with Zod, per `rules/code/server-actions.md`.

## 9. Guards and edge cases

- **Unpriced panel.** A panel whose `(category, band)` has no price, or whose category
  or dimensions are missing, is flagged in the live quote rather than silently priced
  at zero — the same treatment unpriced curtain series receive.
- **Live quote and server quote must share install logic.** There is a known existing
  gap where the two disagree on curtain install cost for unpriced series. Build the
  mesh install calculation once and call it from both sides from the start.
- **Band with no match.** If every band has a `max_area_cm2` and the panel exceeds all
  of them, the panel is unpriced and flagged. The admin UI warns when no open-ended top
  band exists.
- **Split ignored for single draws.** `split_left_cm` / `split_right_cm` are cleared
  when draw is not `Double`.
- **Product line is immutable after creation.** An order's `product_line` cannot be
  changed on edit; the field is not rendered on the edit form and the edit action
  ignores it rather than trusting the submitted value.
- **Archived catalogue rows stay resolvable.** Archiving a category, colour or band
  must not break an existing order's quote — resolution reads by id regardless of
  `is_active`; `is_active` only filters what the consultation form offers.

## 10. Rollout

Order matters — step 1 is the safety gate.

1. **Extract `finaliseQuote`**, change nothing else, confirm all 67 existing tests pass.
2. Migration + `npm run db:codegen`.
3. Mesh calculator with unit tests covering the band edges: area exactly on a threshold,
   area above the top band, a missing `mesh_prices` row, null dimensions, and a colour
   surcharge applied on top of a base price.
4. Validation schemas, server actions.
5. Admin page `/admin/mesh` + the pricing-settings field.
6. Consultation chooser, `MeshPanelFields`, live quote branch.
7. Orders list filter and badge, order detail, print view.
8. End-to-end: configure the catalogue through `/admin/mesh`, create a mesh order,
   check the quote against a hand calculation, walk all six statuses, print.

There is **no seed script**. The three categories, the colour list, the size bands and
the price grid are all created through `/admin/mesh`, the same way vendors and series
pricing are managed today. Mesh is unreachable in the consultation flow until at least
one category is priced, so no feature flag is needed.

## 11. Out of scope

- Blinds. The structure here is the pattern blinds will follow, but blinds remain
  deferred.
- Combo bundles spanning curtains and mesh — orders never mix product lines.
- A mesh photo catalogue.
- Per-m² or per-metre mesh pricing.
- Mesh-specific promotion tiers — mesh uses the existing tiers.
- Customer-visible installation line items.
