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

Recorded per panel: category, colour, width, height, what the frame fixes to, whether
the opening is inset, draw configuration, and — for a double draw — the left/right leaf
split.

**Fixing surface.** The mesh frame is screwed to the **window grille**. That is the
standard installation and the default. The only exception is an opening with no window
at all — a bare vent or gap — where there is no grille and the frame goes to the wall
instead. Stored as `has_window`, a boolean; the mount surface is derived from it rather
than stored twice. It does *not* affect price: install is charged per panel regardless.

**Inset.** When the window is set into the wall there is wall to either side of it, so
the panel has to fit within that space — it may match the measured size exactly but must
never exceed it, or it physically will not go in. Stored as `has_inset`, a boolean.

Deliberately a flag and not measurements. Nobody acts on the lengths; what changes is
that the panel must be made to size with no overhang, and "there is an inset" says that
completely. Four numbers would be four more things to measure on site and nothing more
to do with them.

An earlier draft of this spec recorded a **recess depth** instead, on the theory that a
deep enough reveal allowed an inside mount and a shallow one forced a face mount. That
is not how these are fitted. The column and the field were dropped in
`20260816100000_mesh_mount_surface` rather than left as a number consultants fill in
for nothing — the same reasoning that keeps the inset a flag.

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
| Pricing basis | **Per square foot** — area × the category's rate, not a flat per-panel price and not per metre. |
| What varies the price | **Category** (its rate), **area** and **colour**. Draw does *not* affect price. |
| Rate structure | **One rate per category**, the same S$/ft² at every size. No volume tiers, no minimum billable area. |
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

Both follow the `vendors` pattern: uuid PK, `is_active` soft-archive flag (no hard
deletes), `created_by` → `profiles.id`, `created_at` / `updated_at` timestamptz with the
`set_updated_at` trigger.

```
mesh_categories
  id                       uuid pk
  name                     text not null   -- "AirGuard" / "PetGuard" / "MaxGuard"
  description              text
  vendor_id                uuid references vendors(id)
  cost_rmb_cents_per_sqft  int             -- nullable = cost not configured
  sale_sgd_cents_per_sqft  int             -- nullable = not yet priced
  position                 int not null default 0
  is_active                boolean not null default true
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
```

**The category is the price book.** There is no separate price table and no size
bands: a panel's price is its area × the category's rate, so the rate belongs on
the thing that varies it. Rates are integer **cents per ft²** — S$8.00/ft² is
`800` — keeping the money-in-cents rule intact.

Colour surcharges are **flat per panel**, not per ft². A colour premium is a
per-panel charge; it is not scaled by area even though the base price is.

Category and colour names are stored **verbatim as typed** — no prefix stripping, no
typo correction — consistent with how the curtain catalogue treats labels.

### 5.4 Why there is no price grid

The original design priced a panel by looking up a flat amount in a
category × size-band grid, so every panel inside a band cost the same and the
price stepped at band boundaries. The real commercial model is a per-ft² rate,
which prices continuously — a 1.6 m² panel and a 1.4 m² panel differ.

That makes `mesh_size_bands` and `mesh_prices` redundant, so migration
`20260814100000_mesh_rate_per_sqft` drops both and adds the two rate columns
above. Neither table ever held a row.

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
  has_window      boolean not null default true   -- false = fix to the wall
  has_inset       boolean not null default false  -- true = make to size, no overhang
  draw            mesh_draw_direction
  split_left_cm   int
  split_right_cm  int
  notes           text
  created_at

  index on (room_id, position)
```

The index is composite, matching `windows_room_idx` (`initial.ts:495-499`) — panels are
always read ordered by position within a room.

All product columns are nullable so a draft consultation can be saved half-finished —
except the two booleans, which are not null with defaults. A measurement has a
meaningful "not taken yet"; a mount surface and an inset flag do not, and defaulting a
half-finished draft to the normal installation with no inset is more useful than a third
unknown state on each.

There is deliberately no `updated_at`, matching `windows`.

### 5.6 Assumption column

```sql
alter table public.pricing_assumptions
  add column handyman_mesh_sgd_cents int not null default 0;
```

### 5.7 RLS

- `mesh_categories`, `mesh_colours` — mirror `vendors` exactly: authenticated
  select, admin insert, admin update, no delete.
- `mesh_panels` — mirror `windows` exactly: authenticated select; for-all write
  permitted where the owning order's `consultant_id = auth.uid()` or `is_admin()`,
  joined through `rooms`.

### 5.8 `down()`

Every migration in `data/migrations/` implements `down()`, and the convention drops enum
types last — see `20260710130000_curtain_type_pricing.ts:48` and
`20260708140000_curtain_types.ts:216-217`. A Postgres type cannot be dropped while a
column still uses it, so the order here is not arbitrary:

1. `drop table mesh_panels` — FK to `rooms`, and the only user of `mesh_draw_direction`
2. `drop table mesh_categories`, `mesh_colours`
3. `alter table pricing_assumptions drop column handyman_mesh_sgd_cents`
4. `alter table orders drop column product_line` — the only user of `product_line`
5. `drop type mesh_draw_direction`, `drop type product_line`

Steps 4 and 5 must not be reversed. Dropping tables takes their triggers, indexes and
policies with them, as in the `vendors` migration.

The follow-up migration `20260814100000_mesh_rate_per_sqft` has its own `down()`,
which rebuilds `mesh_size_bands` and `mesh_prices` in full — columns, indexes,
triggers and policies — before dropping the two rate columns, so the pair of
migrations is reversible in either order.

After each migration, run `npm run db:codegen`.

### 5.9 Track systems

The mesh runs on a track system (System 55 / 68 / 80). Two tables describe it, and
both ship with their canonical values already in place — unlike the categories,
colours and rates, this is **engineering data**: a property of the product, identical
for every customer, where hand-entry would only invite a transposition nobody notices
until a panel comes back the wrong size.

```
mesh_system_bands                     -- WHICH system, by width and draw
  id              uuid pk
  max_width_cm    int not null        -- inclusive upper bound
  single_system   text                -- null = not possible at this width
  double_system   text
  position        int not null default 0   -- display order only
  is_active       boolean not null default true
  created_by, created_at, updated_at

  unique index on (max_width_cm) where is_active

mesh_systems                          -- what that system physically costs you
  id                     uuid pk
  name                   text not null
  roller_mm              int not null
  handle_mm              int not null
  side_track_mm          int not null
  track_height_mm        int not null
  track_depth_mm         int not null
  double_cost_rmb_cents  int          -- null = no surcharge
  double_sale_sgd_cents  int
  position, is_active, created_by, created_at, updated_at

  unique index on lower(name)
```

**Resolution** is the first band, by ascending `max_width_cm`, where
`width_cm <= max_width_cm` — ordered on the number, never on `position`, so what gets
built cannot depend on a display column staying in sync. A wider opening needs a
heavier profile; splitting it into two leaves halves what each carries, so a double
draw can use a lighter system than a single of the same width.

**There is deliberately no open-ended band.** A width past the last band is "wider than
anything we build", which must stay an error rather than silently resolving to the
heaviest profile. The partial unique index keeps at most one active band per upper
bound, so resolution never depends on row order.

**Not possible blocks the save.** Unlike every other mesh check — unpriced panels, the
split mismatch — an unbuildable panel is rejected outright by `createMeshOrder` and
`updateMeshOrder`. A quote needing attention is one thing; an order the factory cannot
fulfil is another. This cannot live in Zod: resolution needs the matrix, which is
database state the schema has no access to. The form performs the same check for
immediate feedback, but the actions are the guarantee. Drafts are exempt.

**Track length.** What is left after the hardware:

```
single draw:  track = width − (roller + handle) − side track
double draw:  track = width − 2 × (roller + handle)
```

A double carries a roller and handle on each leaf and no side track; a single carries
one stack and a fixed side track down the far edge. Everything is stored in integer
**millimetres**: the supplier quotes 6.5 / 4.3 / 1.5 and the answer carries a decimal
too (185.2), so centimetres would force floats into a measurement chain — the same
hazard the money-in-cents rule exists to prevent.

**Drop** is the vertical counterpart — what is left of the height once the rails are
subtracted:

```
drop = height − 2 × track height − vertical inset clearance
```

Both rails are the same profile, so one figure is charged twice. Unlike the track it
does **not** vary with the draw: a double draw splits the opening horizontally, never
vertically (§2), so both leaves are full height.

The two inset axes each deduct from their own dimension and nothing else — horizontal
from the track, vertical from the drop. Together, track × drop is the mesh's cut size,
which is what the factory works to.

The consultation form shows the panel laid out along both axes. Each line sums back to
the measurement it came from, so it reads as a check rather than a formula:

```
6.5 (roller) + 4.3 (handle) + 218.4 (track) + 4.3 (handle) + 6.5 (roller) = 240 cm
2.5 (top track) + 145 (drop) + 2.5 (bottom track) = 150 cm
```

**Systems link to the matrix by name**, case-insensitively and trimmed, because the
matrix stores the system as free text an admin types. A name with no `mesh_systems`
row yields "no dimensions set", never a silently wrong length.

**The double-draw surcharge is the one place the system touches price.** A double
carries a second roller and handle, charged flat per panel — one extra hardware set
whatever the size, the same shape as the colour surcharge, and explicitly not scaled
by area. It lives on the system rather than as one global figure because the hardware
differs per system and the matrix pushes wider panels onto heavier ones. This is why
`MeshPanel` carries `draw` into pricing at all.

## 6. Pricing

Mesh reuses the entire back half of the existing engine. Only the per-line-item front
end differs.

| | Curtain | Mesh |
|---|---|---|
| Front end | width × per-metre rate × style multiplier, + S-fold / slim-track add-ons, + track cost | area in ft² × the category's per-ft² rate, + colour surcharge, + the system's double-draw surcharge (§5.9) |
| Freight base | curtain-only COGS (excludes add-ons and tracks) | full panel COGS |
| Back half | freight → other cost → GST → FX → install → discount → margin → groupbuy | identical |

### 6.1 Panel quote

```
area_cm2 = width_cm × height_cm
rate     = mesh_categories[category_id]
cost     = round(area_cm2 × rate.cost_rmb_cents_per_sqft × 10000 / 9290304)
             + (colour.surcharge_rmb_cents ?? 0)
sale     = round(area_cm2 × rate.sale_sgd_cents_per_sqft × 10000 / 9290304)
             + (colour.surcharge_sgd_cents ?? 0)
```

1 ft is 30.48 cm exactly, so 1 ft² is 929.0304 cm². The conversion is held as the
integer pair `10000 / 9290304` rather than a float literal: the numerator stays
exact integer arithmetic and there is a **single** rounding step, which is what
the money-in-cents rule is protecting.

**Rounding is once per panel, not once per order.** Each panel is a line item the
customer can see, so the printed lines must sum to the printed total. A
consequence worth expecting: doubling a panel's area does not always exactly
double its price (12917 → 25833, not 25834).

There is **no minimum billable area** — a small panel bills at its true size.

The colour surcharge is added *after* the area scaling and is **not** scaled:
a colour premium is a per-panel charge. The same applies to the double-draw
surcharge (§5.9), which is added on top for a double draw only.

A panel with a null width or height, no category, or a category with no sale rate
contributes zero to the quote, matching how `windowQuote` treats an unpriced curtain
leg. Surfacing it to the user is a separate concern — see §6.5.

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
that calls `finaliseQuote`. **Every existing test must pass unchanged after this
refactor** — 72 tests across 12 files at time of writing — and that is the safety gate
for the whole phase. Verify with `npx vitest run` and read the count; the number will
have grown by the time this is implemented, so treat 72 as a floor, not a target.

### 6.3 Mesh calculator

New module `src/lib/pricing/mesh-calculator.ts`:

```ts
panelQuote(panel, priceBook, colour): { costRmbCents, saleSgdCents }
computeMeshQuote(panels, priceBook, assumptions, freightMode,
                 extraInstallSgdCents, discountBps): QuoteResult
```

Install is **not** `panels.length × handymanMeshSgdCents`. A blank panel row a
consultant has just added — no category, no dimensions — must not carry an install cost,
or clicking "add panel" drops the live margin before anything is typed.

**Two distinct predicates, both exported from `mesh-calculator.ts`. They are not the
same and must not be collapsed:**

```ts
isMeasured(panel)  = category && width_cm && height_cm      → governs INSTALL (§6.3)
isPriced(panel)    = isMeasured                             → governs WARNINGS (§6.5)
                     && category has a NON-NULL sale_sgd_cents_per_sqft

meshInstallUnits(panels) = panels.filter(isMeasured).length
```

Install is `meshInstallUnits(panels) × handymanMeshSgdCents + extraInstallSgdCents` — a
cost that lowers margin and never appears on the customer quote.

`isPriced` requires a **non-null `sale_sgd_cents_per_sqft`**, not merely the existence of
the category. §5.3 makes both rate columns nullable, and a category is realistically
created before anyone knows its rate. Treating a category's existence as proof of a price
would let exactly the silent-zero case §6.5 exists to catch slip through, and it would
contradict §8.1, which already gates the chooser on a non-null sale rate.

A fully measured panel whose category has no rate is **warned but still an install
unit**: the handyman installs it regardless of whether an admin has priced it.
Defining install as "not warned" would make install cost silently change when someone
edits a rate — do not do it.

**This deliberately diverges from curtains, and that is the point.** `calculator.ts:118`
computes `hasDay = !!win.dayPrice && win.widthCm > 0`, so a curtain window's `offering`
— and therefore its install cost — depends on the *series being priced*, not merely on
the window being measured. That coupling is the root of the known live-vs-server install
mismatch for unpriced-series windows. Mesh keying install off measurement alone is the
correct rule and fixes that class of bug for the new product line. Do not later
"correct" mesh to match curtains; if anything, curtains should move this way.

`computeMeshQuote` and `MeshLiveQuote` both call `meshInstallUnits`; neither
reimplements it. That is what the install-parity guard in §9 requires.

S-fold, slim tracks, track cost and combos do not exist for mesh. The freight mode and
sales channel selectors work unchanged.

### 6.4 Order quote — **both** engines in `order-quote.ts`

`src/lib/pricing/order-quote.ts` contains two independent quote engines, and **both**
need the product-line branch:

1. **`computeOrderQuote(orderId)`** — the single-order path used by the order detail
   page. Branches on `order.product_line`: mesh orders load panels plus the mesh price
   book and call `computeMeshQuote`; curtain orders take the existing path untouched.

2. **`orderStaleFlags(orderIds)`** — the batched staleness sweep for the orders list,
   which avoids an N+1 by selecting all `windows` for a set of orders in one query and
   recomputing each order's live sale.

Missing the second one is a live bug, not a gap. `orderStaleFlags` selects from
`windows` joined through `rooms` with no product-line filter. A mesh order has zero
`windows` rows, so it falls to `computeQuote([])` → `discountedSaleSgdCents = 0`, which
`quoteStaleness` compares against a non-null `price_calc_at_quote_cents`:

```ts
isStale: baselineCalcCents != null && baselineCalcCents !== liveCents
```

Every quoted mesh order would therefore show a permanent re-quote banner that no action
can clear. The fix: `orderStaleFlags` must select the order's `product_line`, fetch
`mesh_panels` for the mesh ids alongside `windows` for the curtain ids in the same
batched sweep, and route each order to the matching calculator. Orders with no rows in
*either* table still behave as they do today.

`price_calc_at_quote_cents` and the stale-quote banner otherwise work unchanged, since
they only ever store a single total. But note that the baseline only exists if the write
paths stamp it — see §8.5.

**Client price book.** `MeshLiveQuote` (§8.2), `computeMeshQuote` (§6.3) and
`meshQuoteWarnings` (§6.5) all take a price book as input, and on the consultation form
that has to arrive as a prop. Add the parallel to `loadCalcConfig` (`order-quote.ts:62`,
which exists specifically to return plain serialisable objects that cross the
server→client boundary):

```ts
loadMeshCalcConfig(inUseIds?: {
  categoryIds: string[]; colourIds: string[];
}): Promise<MeshCalcConfig | null>
  // per-ft² rates keyed by category id, and colours with their
  // surcharges — all plain objects
```

The price book itself is loaded **without** an `is_active` filter, on both
categories and colours: an archived category must keep resolving to the rate an
existing order was quoted at. `is_active` only filters the *option lists* the
form offers.

`/orders/new` and `/orders/[orderId]/edit` pass it to `ConsultationForm` alongside the
existing `calcConfig`. Without this loader the form work in rollout step 7 has nothing
to price against.

**Active-only would break editing.** §9 requires archived catalogue rows to stay
resolvable for orders already referencing them; an active-only loader would render a
blank category or colour select on `/orders/[orderId]/edit` for an order using an
archived row, and saving would silently drop it. So the loader takes the ids the order
actually uses and **unions them into the active set**. `/orders/new` passes nothing and
gets active rows only. Rows included solely because they're in use are marked so the
form can show them as selected but keep them out of the dropdown's choosable options.

### 6.5 Surfacing unpriced panels

There is **no existing precedent** for flagging unpriced items — `windowQuote`
(`calculator.ts:82`) silently returns zero for an unpriced leg, and
`calculator.test.ts:122` asserts that as intended behaviour. So this is new work, and it
must not be smuggled into `QuoteResult`, which has no channel to carry it.

Add a separate pure helper in `mesh-calculator.ts`:

```ts
meshQuoteWarnings(panels, priceBook): {
  unpricedPanels: number[];   // positions
  reasons: Array<'no-category' | 'no-dimensions' | 'no-rate'>
  missingCostPanels: number[];  // sale rate set, cost rate null
}
```

`no-rate` covers both a category absent from the book and a category present with a
null `sale_sgd_cents_per_sqft` — with the rate living on the category itself there is
no longer a structural "missing grid cell" case distinct from an unfilled one, so the
two reasons the old grid needed have collapsed into one.

It takes no `colours` argument — no warning reason involves colour, and a null surcharge
is legal (§5.3), so an unset colour is never a warning.

### A null cost rate is a separate advisory

§5.3 makes `cost_rmb_cents_per_sqft` nullable too, and the realistic workflow produces
half-priced categories: sale rate entered, cost still blank. That panel is **correctly
priced for the customer**, so it does not belong in `unpricedPanels` — but it contributes
zero COGS, which means a zero freight base and a margin reading near 100%.

That failure is invisible by construction. The below-floor guard
(`live-quote.tsx:126`) fires on `shownMarginBps < floorBps`; a 100% margin is *above*
the floor, so nothing trips. Unlike a $0 sale, which is obvious on screen, a missing
cost looks like unusually good news.

So it gets its own `missingCostPanels` list and its own notice — "margin unreliable,
cost not configured" — kept out of the customer-facing unpriced warning. `/admin/mesh`
flags the same condition in amber on the category row, where it can actually be fixed.

**This deliberately does not inherit the curtain behaviour.** `calculator.ts:86` is
`price.costRmbCents ?? 0`, which silently zeroes an unset curtain cost with no warning
anywhere. Inheriting that would be defensible, but it is recorded here as a decision
rather than left as an omission: mesh warns, because a silently overstated margin is the
kind of error that gets discovered in a P&L rather than on screen.

`computeMeshQuote` keeps returning `QuoteResult` unchanged. The live quote panel and
the order detail quote card call `meshQuoteWarnings` separately and render an amber
notice listing the affected panels. Pricing and warning stay decoupled, and curtains
are untouched.

## 7. Validation

New module `src/lib/validation/mesh.ts`.

`src/lib/validation/order.ts` changes in exactly one way: `customerSchema` and
`orderMetaSchema` become exported so they can be reused. No field is added or removed.

**`product_line` appears in no schema at all** — not the shared `orderMetaSchema`, and
not the create schemas either. Putting it anywhere in the validation layer would let
some form parse a field it must never accept, reducing the immutability guarantee in §9
to an "the action ignores it" convention on a value the schema happily validates.

Instead the product line is decided entirely by **which server action you called**:
`createOrder` omits the column and takes the `'curtain'` default from §5.1;
`createMeshOrder` writes `'mesh'` in its insert. No schema anywhere can express it, so
no request can change it — which is a stronger guarantee than an ignore-on-edit rule,
and it means `order.ts` really does change in exactly one way.

```ts
meshPanelSchema        // position, category_id, colour_id, width_cm, height_cm,
                       // has_window, has_inset, draw, split_left_cm,
                       // split_right_cm, notes
meshRoomSchema         // type, label, position, panels[]
meshOrderCreateSchema  // { customer, order, rooms }
meshOrderDraftSchema   // relaxed, mirrors orderDraftSchema
meshOrderEditSchema    // panels carry an optional id for upsert
```

The optional `id` enables upsert but does **not** handle removal — deleting a panel in
the edit form requires the keep-list reconciliation in §8.5, obligation 3.

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

The Mesh card is hidden until **both** of these hold:

1. at least one **active** category has a non-null `sale_sgd_cents_per_sqft`, and
2. `pricing_assumptions.handyman_mesh_sgd_cents > 0`.

The second condition matters as much as the first. That column defaults to `0`, so
gating on price alone would let the first mesh quotes go out with zero installation
cost and an overstated margin — exactly the failure the install-parity guard in §9 is
meant to prevent. The `/admin/mesh` empty state names both prerequisites and links to
`/admin/pricing-settings` for the second.

This is a **setup gate, not a business rule**: it means "an admin has been to pricing
settings", not "install always costs money". A business that genuinely bundles install
elsewhere and wants a zero mesh install cost can't express that through this gate. That
trade is acceptable at launch — a wrong margin on every early quote is worse than a
blocked edge case — but if a legitimate zero-cost case appears, replace the gate with an
explicit "mesh install configured" acknowledgement flag rather than loosening it.

### 8.2 Consultation form — extract shells, don't thread a flag

A `productLine` prop threaded through the existing components does **not** work. Three
concrete blockers in the current code:

- `room-card.tsx:54` is `useFormContext<OrderEditInput>()` and `:56-59` is
  `useFieldArray({ name: \`rooms.${roomIndex}.windows\` })` — bound to the curtain
  schema type and the `windows` field path. Mesh rooms hold `panels[]` (§7), so the path
  is wrong on day one.
- `room-card.tsx:69-92` runs a toilet-variant sync effect keyed on
  `isToiletRoom(roomType)` that calls `setValue` on `day_curtain_type_id`,
  `night_curtain_type_id` and `curtain_type_id`. Meaningless for mesh and actively
  destructive.
- `live-quote.tsx:37` is likewise `useFormContext<OrderEditInput>()`, and every
  `useWatch` below it is typed against the curtain schema.

Renaming the mesh array to `windows` and gating the toilet effect on `productLine` would
compile, but it leaves `useFormContext<OrderEditInput>()` lying about the mesh case and
leaves a field called `windows` holding mesh panels. Extract shells instead:

```
ConsultationForm  ──┬── CustomerSection      shared, unchanged
                    ├── RoomShell            NEW — presentational: room type select,
                    │   │                    label, photo uploader, remove button,
                    │   │                    "add" button. Takes children.
                    │   ├── CurtainRoomCard  owns useFieldArray on …rooms.N.windows
                    │   │                    + the toilet effect (curtain-only)
                    │   └── MeshRoomCard     owns useFieldArray on …rooms.N.panels
                    │         └── MeshPanelFields
                    ├── PricingSection       shared, unchanged
                    └── QuotePanel           NEW — presentational shell
                        ├── CurtainLiveQuote existing logic, renamed
                        └── MeshLiveQuote    calls computeMeshQuote +
                                             meshQuoteWarnings (§6.5)
```

Each room card owns its own `useFormContext` at its own schema type, so neither lies
about the other. The duplicated part is small — a `useFieldArray` plus a map over
fields. The shell holds the rest: room type, label, photos, add/remove, and all the
prototype classes and breakpoints.

**`RoomShell` needs its own narrow type.** It still calls `register` on
`rooms.N.type` and `rooms.N.label`, so it still needs a form context type — and typing
it `OrderEditInput` would reintroduce the same lie one level up. Both schemas share the
`rooms[].{ type, label, position }` prefix, so give the shell a minimal shared type
(or a generic bound over it) covering just that prefix, and nothing else.

**The quoted-price/deposit autofill needs one owner.** `live-quote.tsx:124-135`
auto-fills `order.price_quoted_cents` and a 50% `order.deposit_cents` from
`discountedSaleSgdCents`. Splitting into `CurtainLiveQuote` / `MeshLiveQuote` would give
that effect — and the 50% deposit rule — two owners that drift. Extract it as a shared
hook, `useQuoteAutofill(discountedSaleSgdCents)`, called by both. Same reasoning as
`meshInstallUnits` in §6.3: define the rule once, call it twice.

`ConsultationForm` still takes a `productLine` prop, but it uses it to pick a room card
and a quote component, not to branch inside shared internals.

`MeshPanelFields` is one new component: category select, colour select, width and height
in cm, an "Inset" checkbox beside them, a "Fixing to" select (window grille / wall — no
window), draw select, and —
revealed only when draw is `Double` — the left/right cm pair with a live sum check
against total width (amber hint on mismatch, never blocking).

Follow `docs/prototype/consultation.html` for layout, classes and breakpoints.

### 8.3 Orders list and detail

- `orders-filters.tsx` gains a product-line filter; `orders-table.tsx` and
  `orders-cards.tsx` gain a product-line badge per row.
- `room-summary-card.tsx` / `room-edit-card.tsx` render a panel spec table for mesh
  orders: category, colour, W × H × D, draw, and the split.
- `src/app/(app)/orders/[orderId]/edit/page.tsx` needs a mesh branch. It is the server
  component that loads `windows` rows and shapes them into the form's `defaultValues`
  (and it imports `isToiletRoom` to do it). For a mesh order it must load `mesh_panels`
  instead and build mesh-shaped defaults, then render `ConsultationForm` with
  `productLine="mesh"`. Editing a mesh order is broken without this, regardless of what
  the form components do.
- The print view renders the same panel spec table.

### 8.4 Admin

New page `/admin/mesh`, admin-only, following the `/admin/vendors` pattern (server
components + shadcn dialogs + server actions in `src/lib/actions/mesh-catalogue.ts`).
Two sections:

1. **Categories** — name, description, vendor, **cost ¥/ft², sale S$/ft²**, active
   toggle. This is where mesh pricing lives; there is no separate price screen.
2. **Colours** — name, RMB and SGD surcharge (flat per panel), active toggle

The category row renders a null cost rate in amber when a sale rate is set — the
`missingCostPanels` condition of §6.5, surfaced where an admin can act on it.

Empty state prompts the admin to add the first category, the same way the vendors page
does.

`/admin/pricing-settings` gains the single `handyman_mesh_sgd_cents` field in
`assumptions-form.tsx`.

### 8.4b Surviving a refresh

`useFormDraft` mirrors the form into `sessionStorage` on every change and restores it
on mount, for **both** the curtain and mesh consultation forms. A consultant measures a
whole flat before saving anything, so a stray reload — or a phone reclaiming the tab —
otherwise costs the entire visit.

`sessionStorage`, not `localStorage`: the draft belongs to this tab and this sitting. It
survives the refresh, which is the failure being solved, and dies with the tab rather
than resurfacing days later on top of an order since saved and edited. Keyed per
product and per order, so a create and each edited order stay separate.

Restoring **merges over the current defaults** rather than replacing them — a draft
written before a field existed would otherwise wipe that field's default to
`undefined`. Storage failures (private browsing, quota) are swallowed: losing the
safety net is acceptable, breaking the form is not. It is cleared on the redirect
throw, which is the only success signal a server action gives.

This is **not** the "Save as draft" button. That persists to the database on purpose
and the whole team can see it; this is a local crash-recovery net nobody else sees.

### 8.5 Server actions

New module `src/lib/actions/mesh-orders.ts` — `createMeshOrder`, `updateMeshOrder`,
`saveMeshDraft`. Every action opens with `await requireRole([...])` and validates with
Zod, per `rules/code/server-actions.md`.

Each mesh write path carries the same obligations the curtain paths do. Four of them
fail *silently* if missed — no error, just wrong data — so none is optional:

1. **`stampQuoteBaseline`** (`orders.ts:31`, called at `:132`, `:296`, `:485`) — lift
   into the shared module and call it from all three mesh actions. Skipping it leaves
   `price_calc_at_quote_cents` null forever, which makes the entire staleness path fixed
   in §6.4 dead code for mesh: no re-quote banner could ever fire. Carry over its
   ordering constraint too — the comment at `orders.ts:29` requires it to run **after**
   the transaction commits, because `computeOrderQuote` reads through the base `db`.
2. **The `order_status_events` seed insert** (`:120`, `:473`) — a `status: 'order_made'`
   row inside the transaction. Without it a mesh order's status timeline starts empty.
3. **Panel keep-list reconciliation** (`updateMeshOrder` only) — `updateOrder` does not
   merely upsert. Per room it accumulates a `keepWindowIds` list, then
   `deleteFrom("windows").where("room_id","=",roomId).where("id","not in",keepWindowIds)`
   (`orders.ts:256-260`). `updateMeshOrder` needs the identical pattern over
   `mesh_panels`. An optional `id` for upsert (§7) covers only half the job: without the
   keep-list delete, a panel the consultant removed in the edit form stays in the table
   and the order keeps quoting *and installing* it.
4. **Room-photo storage sweep** (`updateMeshOrder` only) — before deleting dropped
   rooms, `updateOrder` captures every `room_photos.storage_path` about to be
   cascade-deleted (`orders.ts:262-276`) and removes those objects from the bucket
   **after** the transaction commits (`:283-290`), deliberately ordered so a rollback
   can't leave deleted files behind live rows. `rooms` and `room_photos` are shared
   tables, so this is identical work, not mesh-specific work — lift it alongside the
   customer upsert rather than reimplementing it.
5. **Customer upsert** — lift into the shared module and reuse.

Order numbering needs nothing lifted: `display_id` / `seq_year` / `seq_num` are
populated by a database trigger, and `orders.ts:78-81` just inserts the placeholders
`seq_year: 0, seq_num: 0, display_id: ""`. Mesh inserts the same placeholders.

Plus the split-nulling rule from §9.

## 9. Guards and edge cases

- **Unpriced panel.** A panel whose category has no sale rate, or whose category or
  dimensions are missing, prices at zero (§6.1) and is surfaced by the separate
  `meshQuoteWarnings` helper (§6.5). There is no existing unpriced-flagging behaviour
  to copy — curtains deliberately price a missing series at zero and a test asserts it.
- **Missing cost is a different failure.** A category with `sale_sgd_cents_per_sqft`
  filled and `cost_rmb_cents_per_sqft` null quotes the customer correctly but reports
  near-100% margin, and is *not* caught by the below-floor guard because it sits above
  the floor. Surfaced separately as `missingCostPanels` (§6.5), never mixed into the
  unpriced warning.
- **Live quote and server quote must share install logic.** There is a known existing
  gap where the two disagree on curtain install cost for unpriced series. Build the
  mesh install calculation once and call it from both sides from the start.
- **Rounding is per panel.** `scaleByArea` rounds each panel's cost and sale to the
  nearest cent independently, so the line items always sum to the total shown. Do not
  "fix" the resulting off-by-one against a naive area × rate on the order total.
- **Split cleared for single draws — on the server.** `createMeshOrder`,
  `updateMeshOrder` and `saveMeshDraft` write `split_left_cm` and `split_right_cm` as
  `null` whenever `draw` is not `Double`. The form hiding the fields is a convenience,
  not the guarantee; the form is not the only writer.
- **Product line is immutable after creation.** An order's `product_line` cannot be
  changed on edit; the field is not rendered on the edit form and the edit action
  ignores it rather than trusting the submitted value.
- **Archived catalogue rows stay resolvable.** Archiving a category or colour must not
  break an existing order's quote — resolution reads by id regardless of `is_active`;
  `is_active` only filters what the consultation form offers. With the rate living on
  the category, this means `loadMeshPriceBook` must not filter on `is_active` at all.

## 10. Rollout

Order matters — step 1 is the safety gate.

1. **Extract `finaliseQuote`**, change nothing else, confirm the full existing suite
   still passes (`npx vitest run` — 72 tests / 12 files at time of writing).
2. Migration + `npm run db:codegen`.
3. Mesh calculator with unit tests covering the area conversion against a hand
   calculation (1 m² at S$10/ft² is S$107.64), a category absent from the book, **a
   category with a null sale rate**, null dimensions, and a colour surcharge that stays
   flat across two panel sizes. Plus `meshQuoteWarnings` (§6.5) tests for each of the
   three warning reasons, a test that a null cost rate lands in `missingCostPanels` and
   **not** in `unpricedPanels`, and a `meshInstallUnits` test asserting **a blank panel
   row adds no install cost** while a measured-but-unpriced panel **does** (§6.3).
4. **Both engines in `order-quote.ts`** — `computeOrderQuote` *and* `orderStaleFlags`
   (§6.4). Add a regression test that a quoted mesh order with a captured baseline is
   **not** reported stale by `orderStaleFlags`. Add `loadMeshCalcConfig` (§6.4) here
   too, so the form work in step 7 has a price book to consume.
5. Validation schemas, server actions — including the split-nulling rule (§9) and all
   five write-path obligations in §8.5. `stampQuoteBaseline`, the status-event seed, the
   panel keep-list reconciliation and the room-photo storage sweep all fail silently if
   missed, so verify each: remove a panel on edit and confirm the row is gone; remove a
   room with photos and confirm the bucket objects are swept.
6. Admin page `/admin/mesh` + the `handyman_mesh_sgd_cents` pricing-settings field.
7. `RoomShell` (with its narrow shared type) and `QuotePanel` extraction,
   `CurtainRoomCard` / `MeshRoomCard`, `MeshPanelFields`, `CurtainLiveQuote` /
   `MeshLiveQuote`, and the shared `useQuoteAutofill` hook (§8.2). Re-verify the curtain
   consultation and edit flows behave identically after the extraction — including that
   the quoted-price and 50% deposit autofill still works on curtain orders.
8. Consultation chooser, orders list filter and badge, order detail, the mesh branch in
   `edit/page.tsx`, print view.
9. End-to-end: configure the catalogue through `/admin/mesh`, set the mesh handyman
   cost, create a mesh order, check the quote against a hand calculation, confirm the
   status timeline is seeded, confirm the orders list shows no false stale banner, edit
   the order, walk all six statuses, print.

There is **no seed script**. The three categories with their per-ft² rates and the
colour list are all created through `/admin/mesh`, the same way vendors and series
pricing are managed today. Mesh is unreachable in the consultation flow until at least
one category is priced, so no feature flag is needed.

## 11. Out of scope

- Blinds. The structure here is the pattern blinds will follow, but blinds remain
  deferred.
- Combo bundles spanning curtains and mesh — orders never mix product lines.
- A mesh photo catalogue.
- Size-tiered rates (a cheaper S$/ft² on larger panels) and minimum billable areas.
  The rate lives on the category precisely so this stays a one-column change if the
  pricing ever needs tiers.
- Mesh-specific promotion tiers — mesh uses the existing tiers.
- Customer-visible installation line items.
