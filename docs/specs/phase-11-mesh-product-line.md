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
  position       int not null default 0   -- display order only, never pricing
  is_active      boolean not null default true
  created_by, created_at, updated_at
```

Area is stored in **cm²** as an integer (`width_cm × height_cm`), so band matching is
integer arithmetic with no float drift — the same discipline as money-in-cents. 2 m²
is `20000`.

**Band ordering is a structural invariant, not a UI convention.** The price lookup
(§6.1) orders by `max_area_cm2 asc nulls last` directly, so correctness never depends
on `position` being maintained correctly. `position` governs display order only.

At most one open-ended band may be active, otherwise the lookup is nondeterministic.
Enforced in the database:

```sql
create unique index mesh_size_bands_single_open_band
  on public.mesh_size_bands (is_active)
  where max_area_cm2 is null and is_active;
```

Every row the predicate admits has `is_active = true`, so a unique index on that column
permits exactly one active open-ended band. Archived bands are excluded, making a
top-band replacement a two-step archive-then-create.

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

`mesh_prices` gets the `set_updated_at` trigger, same as the three catalogue tables.

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

  index on (room_id, position)
```

The index is composite, matching `windows_room_idx` (`initial.ts:495-499`) — panels are
always read ordered by position within a room.

All product columns are nullable so a draft consultation can be saved half-finished.
There is deliberately no `updated_at`, matching `windows`.

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
band     = first band, ordered by max_area_cm2 ASC NULLS LAST, where
             max_area_cm2 IS NULL OR area_cm2 ≤ max_area_cm2
price    = mesh_prices[category_id][band_id]
cost     = price.cost_rmb_cents  + (colour.surcharge_rmb_cents ?? 0)
sale     = price.sale_sgd_cents  + (colour.surcharge_sgd_cents ?? 0)
```

The ordering is on `max_area_cm2`, never on `position` — pricing correctness must not
depend on a display-ordering column staying in sync (§5.3).

A panel with a null width or height, no category, or no matching `mesh_prices` row
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

Install is **not** `panels.length × handymanMeshSgdCents`. A blank panel row that a
consultant has just added — no category, no dimensions — must not carry an install cost,
for two reasons: clicking "add panel" would otherwise drop the live margin before
anything is typed, and it would diverge from the curtain rule in exactly the direction
§9 warns about (`calculator.ts:142` resolves an unmeasured window to `offering: 'none'`,
and `installFor` charges zero for it).

Define the predicate once, in `mesh-calculator.ts`, and export it:

```ts
meshInstallUnits(panels): number   // panels with a resolved category AND
                                   // both width_cm and height_cm
```

Install is then `meshInstallUnits(panels) × handymanMeshSgdCents + extraInstallSgdCents`
— a cost that lowers margin and never appears on the customer quote.

This is the same predicate `meshQuoteWarnings` (§6.5) uses to decide "unpriced", so the
two cannot drift. `computeMeshQuote` and `MeshLiveQuote` both call `meshInstallUnits`;
neither reimplements it. That is what the install-parity guard in §9 requires.

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
loadMeshCalcConfig(): Promise<MeshCalcConfig | null>
  // category × band price grid, active size bands (with max_area_cm2),
  // and active colours with their surcharges — all plain objects
```

`/orders/new` and `/orders/[orderId]/edit` pass it to `ConsultationForm` alongside the
existing `calcConfig`. Without this loader the form work in rollout step 7 has nothing
to price against.

### 6.5 Surfacing unpriced panels

There is **no existing precedent** for flagging unpriced items — `windowQuote`
(`calculator.ts:82`) silently returns zero for an unpriced leg, and
`calculator.test.ts:122` asserts that as intended behaviour. So this is new work, and it
must not be smuggled into `QuoteResult`, which has no channel to carry it.

Add a separate pure helper in `mesh-calculator.ts`:

```ts
meshQuoteWarnings(panels, priceBook, colours): {
  unpricedPanels: number[];   // positions
  reasons: Array<'no-category' | 'no-dimensions' | 'no-band' | 'no-price-row'>
}
```

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

The Mesh card is hidden until **both** of these hold:

1. at least one `mesh_prices` row has a non-null `sale_sgd_cents`, and
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

`MeshPanelFields` is one new component: category select, colour select, width / height /
depth in cm, draw select, and — revealed only when draw is `Double` — the left/right cm
pair with a live sum check against total width (amber hint on mismatch, never blocking).

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
`saveMeshDraft`. Every action opens with `await requireRole([...])` and validates with
Zod, per `rules/code/server-actions.md`.

Each mesh write path carries the same four obligations the curtain paths do. Two are
easy to miss and both are silent failures:

1. **`stampQuoteBaseline`** (`orders.ts:31`, called at `:132`, `:296`, `:485`) — lift
   into the shared module and call it from all three mesh actions. Skipping it leaves
   `price_calc_at_quote_cents` null forever, which makes the entire staleness path fixed
   in §6.4 dead code for mesh: no re-quote banner could ever fire. Carry over its
   ordering constraint too — the comment at `orders.ts:29` requires it to run **after**
   the transaction commits, because `computeOrderQuote` reads through the base `db`.
2. **The `order_status_events` seed insert** (`:120`, `:473`) — a `status: 'order_made'`
   row inside the transaction. Without it a mesh order's status timeline starts empty.
3. **Customer upsert** — lift into the shared module and reuse.
4. **Order numbering** — nothing to lift. `display_id` / `seq_year` / `seq_num` are
   populated by a database trigger; `orders.ts:78-81` just inserts the placeholders
   `seq_year: 0, seq_num: 0, display_id: ""`. Mesh inserts the same placeholders.

Plus the split-nulling rule from §9.

## 9. Guards and edge cases

- **Unpriced panel.** A panel whose `(category, band)` has no price, or whose category
  or dimensions are missing, prices at zero (§6.1) and is surfaced by the separate
  `meshQuoteWarnings` helper (§6.5). There is no existing unpriced-flagging behaviour to
  copy — curtains deliberately price a missing series at zero and a test asserts it.
- **Live quote and server quote must share install logic.** There is a known existing
  gap where the two disagree on curtain install cost for unpriced series. Build the
  mesh install calculation once and call it from both sides from the start.
- **Band with no match.** If every band has a `max_area_cm2` and the panel exceeds all
  of them, the panel is unpriced and warned. The `/admin/mesh` band editor warns when no
  active open-ended band exists; the database separately prevents there being more than
  one (§5.3).
- **Split cleared for single draws — on the server.** `createMeshOrder`,
  `updateMeshOrder` and `saveMeshDraft` write `split_left_cm` and `split_right_cm` as
  `null` whenever `draw` is not `Double`. The form hiding the fields is a convenience,
  not the guarantee; the form is not the only writer.
- **Product line is immutable after creation.** An order's `product_line` cannot be
  changed on edit; the field is not rendered on the edit form and the edit action
  ignores it rather than trusting the submitted value.
- **Archived catalogue rows stay resolvable.** Archiving a category, colour or band
  must not break an existing order's quote — resolution reads by id regardless of
  `is_active`; `is_active` only filters what the consultation form offers.

## 10. Rollout

Order matters — step 1 is the safety gate.

1. **Extract `finaliseQuote`**, change nothing else, confirm the full existing suite
   still passes (`npx vitest run` — 72 tests / 12 files at time of writing).
2. Migration + `npm run db:codegen`.
3. Mesh calculator with unit tests covering the band edges: area exactly on a threshold,
   area above the top band, a missing `mesh_prices` row, null dimensions, and a colour
   surcharge applied on top of a base price. Plus `meshQuoteWarnings` (§6.5) tests for
   each warning reason, and a `meshInstallUnits` test asserting **a blank panel row adds
   no install cost** (§6.3).
4. **Both engines in `order-quote.ts`** — `computeOrderQuote` *and* `orderStaleFlags`
   (§6.4). Add a regression test that a quoted mesh order with a captured baseline is
   **not** reported stale by `orderStaleFlags`. Add `loadMeshCalcConfig` (§6.4) here
   too, so the form work in step 7 has a price book to consume.
5. Validation schemas, server actions — including the split-nulling rule (§9) and all
   four write-path obligations in §8.5, `stampQuoteBaseline` and the status-event seed
   especially.
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
