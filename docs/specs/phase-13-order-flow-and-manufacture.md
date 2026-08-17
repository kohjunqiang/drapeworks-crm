# Phase 13 — Order flow & manufacturing measurements

**Status:** 13A implemented and verified 2026-08-17; 13B specified, not implemented; 13C blocked on a vendor Excel sample
**Date:** 2026-08-17
**Depends on:** Phase 6 (status workflow), Phase 9 (pricing foundation), Phase 11 (mesh), Phase 12 (blinds)

---

## 1. Why

The fulfilment flow starts in the wrong place and skips two real steps.

Today an order is born at `order_made`. But nothing has been *made* — a consultant has
recorded measurements and a quote, and the company is waiting for money. The next status
is `sent_logistic`, which jumps straight from "we took the order" to "we handed it to a
freight partner", silently swallowing the two events the business actually cares about:
**the deposit arriving**, and **the order going to the vendor who manufactures it**.

Worse, there is no moment in the system where anyone decides *what dimensions to
manufacture*. A consultant measures the window opening. The vendor needs something else —
the opening minus a hem allowance at the bottom and a clearance allowance across the
width. Today that arithmetic happens in someone's head, on the way into a spreadsheet,
with no record of what was sent or why.

This phase inserts the two missing statuses, and puts a **deliberate, reviewable,
recorded step** between deposit and vendor where the manufacturing dimensions are derived,
inspected against the measured ones, adjusted if needed, and frozen.

## 2. Scope & phasing

Three sub-phases. **A** and **B** are specified here in full. **C** is architecturally
decided but cannot be written until a vendor Excel sample exists (§15).

| | Scope | Blocked on |
|---|---|---|
| **13A** | Status flow, deposit CTA, order reference, remove `install_width_cm` | nothing |
| **13B** | Allowance config, manufacture measurements, reconciliation view, locking, costing | blind + mesh allowance values (fillable in the UI, so not a code blocker) |
| **13C** | Vendor PDF generation | a sample vendor Excel |

---

# Phase 13A

## 3. Status flow

```
order_recorded    ← rename of order_made
deposit_received  ← new
sent_to_vendor    ← new
sent_logistic
shipping_sg
delivered_checked
fulfilment
completed
```

`sent_to_vendor` is **not** a rename of `sent_logistic`. They are different events: the
vendor manufactures, and the logistics partner ships the finished goods. An order sits at
`sent_to_vendor` for the whole manufacturing lead time.

`order_made` becomes `order_recorded` because nothing is made at that point. The order has
been *recorded*; the company is waiting on a deposit.

### 3.1 Migration

`data/migrations/20260817150000_order_flow_statuses.ts`

```sql
alter type public.fulfilment_status rename value 'order_made' to 'order_recorded';
alter type public.fulfilment_status add value 'deposit_received' after 'order_recorded';
alter type public.fulfilment_status add value 'sent_to_vendor' after 'deposit_received';
```

`rename value` rewrites every existing row, the `orders.current_status` default, and every
`order_status_events.status` row transparently — enum values are stored by internal id, not
by text. At time of writing the database holds **2 orders (1 draft) and 8 windows, all at
`order_made`**, so there is no meaningful data risk here.

> **Implementation gotcha — do not skip this.** Postgres forbids *using* an enum value in
> the same transaction that added it, and the Kysely migrator wraps each migration in a
> transaction. This migration must therefore only **add** the values; it must not insert or
> compare against them. Redefining `validate_status_transition` in the same migration is
> safe because a plpgsql body is stored as text and not parsed for enum literals at
> creation time — and in any case the flow array below is `text[]`, not the enum type.

Then redefine the transition validator's flow array (unchanged logic, new members):

```sql
v_flow text[] := array[
  'order_recorded','deposit_received','sent_to_vendor',
  'sent_logistic','shipping_sg','delivered_checked','fulfilment','completed'
];
```

The ±1 rule, the same-status-note rule, and the RLS policy `ose_insert_advance_or_note` are
all unchanged.

### 3.2 Application layer

`src/lib/status-flow.ts` — extend all three maps. Suggested labels and colours:

| Value | Label | Colour |
|---|---|---|
| `order_recorded` | Order Recorded | `bg-slate-100 text-slate-700` |
| `deposit_received` | Deposit Received | `bg-amber-100 text-amber-700` |
| `sent_to_vendor` | Sent to Vendor | `bg-orange-100 text-orange-700` |
| `sent_logistic` | Sent to Logistic Partner | `bg-indigo-100 text-indigo-700` |
| `shipping_sg` | Shipping to SG | `bg-blue-100 text-blue-700` |
| `delivered_checked` | Delivered & Checked | `bg-emerald-100 text-emerald-700` |
| `fulfilment` | Fulfilment Arrangement | `bg-purple-100 text-purple-700` |
| `completed` | Completed | `bg-green-100 text-green-700` |

> The README's "don't reintroduce amber" rule is about the **accent** colour (teal replaced
> amber), not status badges, which are explicitly semantic per stage. Amber is already in
> use across the app for warning banners (`orders/new/page.tsx:123`, `admin/product/mesh/page.tsx:64`).

`STATUS_FLOW` gains the two members in order. `nextStatus` and `statusIndex` need no change.

### 3.3 Hardcoded status strings that must be updated

`STATUS_FLOW` is *not* the only place a status is named. Four call sites hardcode
`"order_made"` and must change to `"order_recorded"`, or new orders will fail to insert
against the renamed enum:

| File | Line | What |
|---|---|---|
| `src/lib/actions/orders.ts` | 118 | initial `order_status_events` row on order creation |
| `src/lib/actions/orders.ts` | 479 | same, on the second creation path |
| `src/lib/actions/mesh-orders.ts` | 127 | initial status event for a mesh order |
| `src/lib/actions/mesh-orders.ts` | 326 | same, second path |

`StatusTimeline`, `StatusBadge`, `advanceOrderStatus`, `revertOrderStatus` and
`orders-filters.tsx` all derive from `STATUS_FLOW` and need no change.

### 3.4 Dashboard stat buckets

`orders/page.tsx:61–71` hardcodes two status groups behind the dashboard tiles. Both need
revisiting, because the old `order_made` bucket has split into three distinct stages.

| Tile | Today | Phase 13 |
|---|---|---|
| Awaiting shipment | `order_made`, `sent_logistic`, `shipping_sg` | `sent_to_vendor`, `sent_logistic`, `shipping_sg` |
| Ready for installation | `delivered_checked`, `fulfilment` | unchanged |

`order_recorded` and `deposit_received` belong to no tile. An order with no deposit is not
awaiting shipment, and counting it as such is what the old flow got wrong. Both remain
visible in "Active orders" and in the status filter.

> **Optional, not specified:** a fifth "Awaiting deposit" tile counting `order_recorded`.
> The grid is `grid-cols-2 md:grid-cols-4`, so a fifth card would need a layout change.
> Left out unless asked for.

`orders-filters.tsx` renders from `STATUS_FLOW` and picks up the new statuses for free.
Confirm the filter row still fits on mobile at eight statuses — if it overflows it should
scroll horizontally like the product tabs rather than wrap.

## 4. Deposit CTA

**No new schema.** The existing `AdvanceStatusButton` already advances one step, is already
restricted to ops and admin by `advanceOrderStatus` (`requireRole(["ops","admin"])`) and by
RLS, and already records who acted and when via `order_status_events.created_by` /
`created_at`. That is the whole requirement.

The only change is wording. When an order sits at `order_recorded`, the button reads
**"Record deposit received"** instead of "Advance →", and the dialog title reads
**"Record deposit received"**. Implement by extending the existing `nextLabel` prop with an
optional `ctaLabel`, resolved on the order detail page from the current status.

Deliberately **not** captured: amount received, payment method, reference, partial payments.
Ops advances the order when the money is correct; the note field is there if they want to
record anything. `orders.deposit_cents` remains the *quoted* deposit and is not touched.

## 5. Order reference

`display_id` (`DW-YYYY-NNNN`) stays exactly as it is — trigger-assigned, unique, and used as
the order's identity across the dashboard, the detail page and URLs. Making it editable would
make past orders hard to find.

Instead, `data/migrations/20260817151000_order_reference.ts`:

```sql
alter table public.orders add column order_reference text;
create unique index orders_order_reference_key
  on public.orders (order_reference) where order_reference is not null;
```

A partial unique index so many orders may have none, but no two may share one.

- Editable by **admin and ops** via a small inline edit on the order detail page.
- Displayed beside `display_id` in the detail header, and in the orders table when set.
- **Stays editable after the order locks** (§12) — it is a paperwork identifier, not a
  manufacturing input, and a vendor may ask for a renumber mid-production.
- Printed on the vendor PDF (13C). Both vendors on a two-vendor order carry the **same**
  reference; per-vendor numbering is out of scope and would be additive.

New Server Action `setOrderReference` in `src/lib/actions/orders.ts`:
`requireRole(["ops","admin"])`, Zod-validated (`z.string().trim().min(1).max(64).nullable()`),
returns a friendly error on unique violation rather than a raw Postgres error.

## 6. Removing `install_width_cm`

`windows.install_width_cm` is deleted, along with the "Installation Width (cm)" input in
`window-fields.tsx` (three occurrences: toilet, regular and blind variants) and the
"Install W" column in `room-summary-card.tsx` (three occurrences).

**Why it is safe to delete.** The column was traced end to end:

- It originates in commit `9a97d0a` — the initial scaffold — as `win.installWidth`, an
  Alpine.js model in the HTML prototype (`docs/prototype/consultation.html:211`).
- It was copied into `phase-4-consultation.md` as a bare column in a `create table` block.
  **No spec, rule file or comment anywhere in the repo says what it measures.**
- **No business logic reads it.** `calculator.ts`, `mesh-calculator.ts`, `cogs-breakdown.ts`,
  `order-quote.ts` and `quote-staleness.ts` all use `width_cm` only.
- Its entire lifecycle is: typed into the form → stored → rendered in one table column.
  Nothing consumes it.
- `mesh_panels` never had the field, which confirms it was never load-bearing.

The eight rows currently holding values contain `8` and `10` against windows 250–300cm wide.
Those are not widths. They are placeholder numbers typed into an unlabelled box during
testing.

Leaving an undefined field adjacent to a new manufacturing-measurement feature is an
invitation to mis-enter data, which is why this is removed in the same phase rather than left
alone.

`data/migrations/20260817152000_drop_install_width.ts` drops the column. The `down()` migration
re-adds it as a nullable int; the values are not recoverable and are not worth recovering.

> **If the vendor sheet turns out to need a mount depth or track projection** (13C, once the
> Excel sample lands), add a new, properly-named and properly-documented column. Do not
> resurrect this one.

---

# Phase 13B

## 7. Allowance configuration

The manufacturing allowance varies **by product line only** — one pair of deltas for curtains,
one for blinds, one for mesh. Not per series, not per vendor, not per blind type.

`data/migrations/20260817130000_manufacture_allowances.ts`:

```sql
create table public.manufacture_allowances (
  product_line     text primary key check (product_line in ('curtain','blind','mesh')),
  width_delta_cm   int,
  height_delta_cm  int,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.profiles(id)
);

insert into public.manufacture_allowances (product_line, width_delta_cm, height_delta_cm)
values ('curtain', -2, -4), ('blind', null, null), ('mesh', null, null);
```

**Deltas are stored signed and negative.** `-4` means "four centimetres shorter than
measured". Storing a signed number rather than a magnitude means a future positive allowance
needs no schema change and no interpretation flag. The UI renders `−4 cm` and accepts a
signed integer.

`null` means **unconfigured**, which is different from `0` (no adjustment). Curtain is seeded
with the known values; blind and mesh are left null for an admin to fill in. An order whose
product lines are not all configured **cannot be confirmed** (§10.2).

**RLS.** Read: any authenticated user (the consultation and quote paths need it). Write:
admin only, via `public.is_admin()`.

### 7.1 Admin UI

A fourth tab, **Allowances**, in `src/components/admin/product-tabs.tsx`, at
`/admin/product/allowances`. This sits under Product, **not** under pricing settings — an
allowance is a physical manufacturing fact about a product, and has nothing to do with money.

The page is a three-row table (Curtains / Blinds / Mesh), each row with a width delta and a
height delta input and a single save button, following the pattern already established by the
mesh minimum-area grid. Unconfigured rows render an explicit "Not set" state and a warning
that orders containing that product line cannot be sent to a vendor.

Server Action `saveManufactureAllowance` in a new `src/lib/actions/manufacture.ts`:
`requireRole(["admin"])`, Zod `z.number().int().min(-100).max(100)`, `revalidatePath`.

## 8. Manufacture measurements — data model

`data/migrations/20260817131000_manufacture_measurements.ts`:

```sql
create table public.manufacture_measurements (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references public.orders(id) on delete cascade,
  window_id         uuid references public.windows(id) on delete cascade,
  mesh_panel_id     uuid references public.mesh_panels(id) on delete cascade,

  source_width_cm   int,
  source_height_cm  int,
  width_delta_cm    int not null,
  height_delta_cm   int not null,
  mfg_width_cm      int,
  mfg_height_cm     int,

  is_overridden     boolean not null default false,
  override_reason   text,

  confirmed_at      timestamptz not null default now(),
  confirmed_by      uuid references public.profiles(id),
  updated_at        timestamptz not null default now(),

  constraint mm_exactly_one_line_item check (
    (window_id is not null and mesh_panel_id is null) or
    (window_id is null and mesh_panel_id is not null)
  ),
  constraint mm_override_has_reason check (
    not is_overridden or (override_reason is not null and length(trim(override_reason)) > 0)
  )
);

create unique index mm_window_key on public.manufacture_measurements (window_id)
  where window_id is not null;
create unique index mm_mesh_panel_key on public.manufacture_measurements (mesh_panel_id)
  where mesh_panel_id is not null;
create index mm_order_idx on public.manufacture_measurements (order_id);
```

**One polymorphic table, not two.** A window and a mesh panel are both "a thing with a width
and a height that gets manufactured". The reconciliation view, the costing lookup and the
vendor PDF all want a single uniform list; two tables would double every code path for no
gain. The check constraint makes the polymorphism safe.

**`order_id` is denormalised** onto the row (it is reachable via `window → room → order`).
This is deliberate: the reconciliation view, the lock check and the PDF generator all load by
order, and the alternative is a three-table join on every read.

**`source_*` is a snapshot, not a reference.** The measured values are copied in at
confirmation time. `windows.width_cm` is never modified — this is a second set of data, as
required — but the record must also stay truthful on its own terms, so that a later reading
of "what did we send the vendor, and what did we base it on" does not depend on the source row
having survived unchanged.

**Rows are written on confirmation only.** The reconciliation screen computes candidate values
live from the allowance table and holds overrides in component state; nothing is persisted
until Confirm. If losing in-progress overrides on a refresh proves annoying in practice, add
the `sessionStorage` draft pattern already used by the mesh form (`use-form-draft.ts`) — but
do not build it speculatively.

**RLS.** Select: any authenticated user. Insert and update: ops and admin only
(`public.is_ops() or public.is_admin()`). No delete policy — nothing hard-deletes here.

## 9. The reconciliation view

Route: `/orders/[orderId]/manufacture`. Server Component, ops and admin only via
`requireRole(["ops","admin"])`; anyone else is redirected to the order detail page.

**Reachable when the order is at `deposit_received`** — that is precisely the gap the screen
fills. At `sent_to_vendor` and beyond it renders read-only with an Amend affordance for admins
(§13). Before `deposit_received` it redirects back with a message.

### 9.1 Layout

Measured on the left, manufacturing on the right, grouped by room then window, mirroring the
grouping already used by `room-summary-card.tsx` so the two screens read the same way.

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

The delta must be **unmissable** — that is the entire point of the screen. Each adjusted
figure shows the resulting value alongside a signed delta chip (`−4 cm`) in a distinct
colour. An unadjusted figure (delta `0`) shows no chip and is visually quiet.

On mobile the two columns stack, measured above manufacturing, with the delta chip carrying
the comparison rather than horizontal alignment.

### 9.2 Overrides

Any manufacturing figure is editable inline. Editing one sets `is_overridden` for that row and
reveals a **required** reason field; the check constraint enforces this at the database level
too. An overridden row renders distinctly from a defaulted one — a reader must be able to see
at a glance which numbers came from the rule and which came from a person, and why.

Clearing an override restores the computed default.

### 9.3 Confirmation

A sticky footer summarises the set ("18 windows · 3 overridden") and holds the primary action,
**"Confirm manufacturing measurements"**. It opens a dialog that states plainly what
confirming does: freezes these dimensions for the rest of the order, locks the order from
further editing, and moves it to Sent to Vendor.

## 10. Confirmation behaviour

Server Action `confirmManufactureMeasurements` in `src/lib/actions/manufacture.ts`.

### 10.1 Transaction

`requireRole(["ops","admin"])`, Zod-validated input, then **one Kysely transaction**:

1. Re-read the order and assert `current_status = 'deposit_received'`.
2. Re-read every window and mesh panel for the order.
3. Re-resolve allowances server-side — **never trust deltas from the client**. The client
   sends overrides and reasons; the server recomputes every defaulted value.
4. Insert one `manufacture_measurements` row per line item.
5. Insert an `order_status_events` row at `sent_to_vendor`, which fires the existing
   `sync_order_current_status` trigger and auto-advances the order.

Because step 5 goes through the normal status-events path, the existing transition validator
and RLS policy apply unchanged, and the advance is recorded with actor and timestamp like any
other.

### 10.2 Preconditions

Confirmation is refused, with a message naming the specific problem, when:

- the order is not at `deposit_received`;
- any product line present in the order has a `null` allowance — the message names which
  ("Blind allowance is not configured. Set it under Product → Allowances.");
- any line item has a null or non-positive `width_cm` or `height_cm`;
- any computed manufacturing dimension is `≤ 0` (a 3cm-wide window minus a 4cm allowance is
  not manufacturable and must be overridden explicitly);
- an override is present without a reason.

## 11. Costing off manufacturing dimensions

**The customer's price does not change.** `orders.price_quoted_cents` is what the customer
agreed to and what they paid a deposit against. Manufacturing dimensions are always smaller
than measured ones, so costing the sale off them would silently reduce a price the customer
has already committed to. Only **cost / COGS** and the **vendor sheet** use them.

This is not a free change, because the calculator currently derives cost and sale from a
single width in the same function.

### 11.1 Curtains and blinds

`CalcWindow` gains one optional field:

```ts
export type CalcWindow = BreakdownIdentity & {
  widthCm: number | null;
  /** Manufacturing width, when a set has been confirmed. Cost only — the sale
   *  side always uses widthCm, which is what the customer was quoted on. */
  costWidthCm?: number | null;
  // …dayPrice, nightPrice, blindPrice, addSFold, addSlimTracks,
  //   comboPriceSgdCents — all unchanged.
};
```

`curtainLeg`, `blindLeg` and `addonLeg` take both widths and use `costWidthCm ?? widthCm` for
`costRmbCents` and `widthCm` for `saleSgdCents`. Every other rule — the style multiplier on
cost only, combo overrides on sale only, per-unit add-ons ignoring width — is unchanged.

`order-quote.ts` left-joins `manufacture_measurements` and populates `costWidthCm` when a row
exists. With no confirmed set the field is absent and behaviour is byte-identical to today.

### 11.2 Mesh

Mesh is priced on area, so both dimensions matter, and `panelQuote` deliberately applies the
minimum billable area **to both sides** so that "a minimum never flatters the margin".

`MeshPanel` gains `costWidthCm` and `costHeightCm`. `panelQuote` computes
`panelBillableArea` **twice** — once on measured dimensions for the sale side, once on
manufacturing dimensions for the cost side — so the minimum-area floor is honoured
independently on each. Colour and double-draw surcharges are flat per-panel charges and are
unaffected.

**The system band is resolved from the measured width, not the manufacturing width.** The
band picks a physical track system for the opening, which is a survey decision about the
window, not a property of the fabric being cut. Resolving it from a 2cm-smaller number could
silently drop a panel into a different system. This is a deliberate decision; if the business
disagrees it is a one-line change in `panelQuote`.

### 11.3 Quote staleness

`quote-staleness.ts` compares the locked sale price against a recomputed sale price. Since
none of the above alters the sale side, confirming a manufacturing set must **not** raise the
stale-quote banner. Add an explicit regression test for this — it is the most likely
unintended consequence of this section.

## 12. Locking

From `sent_to_vendor` onward the **whole order** is frozen: customer details, property fields,
discount and promo, deposit, rooms, windows, mesh panels, series and product selections.

Helper in `src/lib/status-flow.ts`:

```ts
export function isLocked(s: FulfilmentStatus): boolean {
  return statusIndex(s) >= statusIndex("sent_to_vendor");
}
```

Enforced at three levels, per the defence-in-depth rule in `rules/data/rls.md`:

1. **Server Actions.** `updateOrder`, `updateMeshOrder`, `deleteOrder` and the re-quote action
   read the current status first and throw `"This order is locked — it has been sent to the
   vendor."` No new bypasses.
2. **UI.** `/orders/[orderId]/edit` redirects to the detail page with an explanation. The Edit
   and Delete buttons on the detail page are replaced by a lock notice naming the status.
3. **RLS.** The `orders_update_owner_admin`, `rooms_write_owner_admin` and
   `windows_write_owner_admin` policies gain a status predicate so a missed guard cannot
   write. Mesh panel policies get the same treatment.

**Explicitly still permitted while locked:** status advancement and reverts, status notes,
photo upload, `order_reference` edits, and amending the manufacture set (§13). These write to
different tables and are unaffected by the policy change above.

## 13. Amending a confirmed set

Admin only. The order **stays at `sent_to_vendor`** — an amendment is a correction to what the
vendor is building, not a step backwards through the flow.

`amendManufactureMeasurements` in one transaction:

1. `requireRole(["admin"])`, assert `current_status = 'sent_to_vendor'`.
2. Update the affected `manufacture_measurements` rows, bumping `updated_at`.
3. Insert an `order_status_events` row **at the current status** with a note
   `[MEASUREMENTS AMENDED] <reason>`. This is a same-status insert, which the existing
   transition validator and RLS policy already allow, so the amendment lands in the timeline
   the whole team already reads.
4. Mark any generated vendor document superseded (13C) and regenerate.

`source_*` values are **not** re-snapshotted on amendment — they record what the set was
originally derived from, and the order is locked so they cannot have changed.

## 14. Validation

New Zod schemas in `src/lib/validation/manufacture.ts`, shared client and server:

- `allowanceSchema` — `product_line` enum, two signed ints in `[-100, 100]`.
- `manufactureLineSchema` — line item id (window or mesh panel), optional overridden width and
  height as positive ints, optional trimmed reason. Refinement: an overridden value requires a
  non-empty reason.
- `confirmManufactureSchema` — order uuid plus an array of line schemas.

Deltas and computed dimensions are **not** accepted from the client at all; the server derives
them (§10.1).

## 15. Vendor PDF — Phase 13C

Not specified here. **Blocked on a sample vendor Excel.** The layout is the entire substance
of this sub-phase and cannot be invented.

The architecture is decided:

- **Generate the PDF directly.** Not Excel-to-PDF, which needs headless LibreOffice in the
  Docker image (roughly half a gigabyte, slow cold starts, fragile across base-image bumps)
  for a format that is not the deliverable. Not overlay-onto-a-blank-PDF, which cannot grow to
  fit a variable number of windows without hand-tuned page-break logic per vendor.
- **`@react-pdf/renderer`** — declarative layout, renders server-side, paginates a variable-length
  table without special handling, matches the React idiom of the codebase.
- **Per-vendor layout in code.** The trade-off is explicit: adding a vendor or changing a
  vendor's format is a code change, not self-serve. Acceptable at the current vendor count.
  The maintained Excel files remain the reference for what each sheet should look like.
- **One file per vendor** for a multi-vendor order, each containing only that vendor's line items.
- Stored in a private Supabase Storage bucket, attached to the order, versioned so an amendment
  supersedes rather than overwrites, and re-openable later.
- **Download on desktop; native share sheet on mobile** via the Web Share API with the file
  attached, which surfaces WeChat as a target. There is no way to push a file into WeChat from
  desktop web and none should be attempted.

Content will draw on: order reference, customer, room and window identity, manufacturing width
and height, series and type labels (verbatim — `rules/code/forms.md`), draw direction, S-fold
and slim-track flags, and notes.

## 16. Tests

Vitest, alongside the existing 233. New coverage:

| Area | Cases |
|---|---|
| `status-flow` | eight members in order; `nextStatus` across the two new steps; `isLocked` true from `sent_to_vendor` onward and false before |
| Order creation | a new curtain order and a new mesh order both land at `order_recorded`, covering all four hardcoded call sites in §3.3 |
| Allowance resolution | configured line resolves; `null` line refuses confirmation and names the line |
| Delta computation | curtain −2/−4 applied to width and height; zero delta produces no chip state; result `≤ 0` refused |
| Overrides | override without reason refused (schema and constraint); override survives the server's recompute; clearing restores the default |
| Confirmation | wrong-status refused; rows written one per line item; status advances to `sent_to_vendor` in the same transaction; a failure rolls back both |
| Locking | each guarded Server Action throws when locked; notes, photos, `order_reference` and amendments still succeed |
| Costing | `costWidthCm` changes cost and leaves sale untouched; absent field is byte-identical to today; mesh applies the minimum-area floor on both sides independently; system band resolves from measured width |
| Staleness | **confirming a manufacturing set does not raise the stale-quote banner** |
| Amendment | order stays at `sent_to_vendor`; a timeline note is written; `source_*` unchanged |

## 17. Rollout

1. 13A migrations, `npm run db:codegen`, status-flow and CTA changes, `install_width_cm` removal.
2. Verify on the live database: the 2 existing orders read `Order Recorded`, the dashboard
   filters show eight statuses, and advancing works end to end.
3. 13B migrations, `npm run db:codegen`, then allowance UI → reconciliation view → confirmation →
   locking → costing, in that order. Each is independently testable.
4. Fill in the blind and mesh allowances through the admin UI before any non-curtain order can
   be confirmed.
5. `npm run build` and `npm run lint` clean before 13C is started.

## 18. Out of scope

- Payment amounts, methods, references, or partial-payment tracking on the deposit step.
- Per-vendor order numbering — both vendors on a split order share one `order_reference`.
- Reviving `install_width_cm` under any name without a stated definition.
- Any change to the customer-facing quoted price as a result of manufacturing dimensions.
- Per-series or per-blind-type allowances. Product line only.
- Vendor PDF layout (13C).

## 19. Decisions taken without an explicit answer

Flagged for the reviewer. Each is a stated assumption, not a discovered fact:

1. **`install_width_cm` is dropped now** rather than kept pending the Excel sample (§6). If the
   vendor sheet needs a mount depth, a new named field is added in 13C.
2. **Both vendors on a split order share one `order_reference`** (§5).
3. **`order_reference` remains editable after the order locks** (§5, §12).
4. **The mesh system band resolves from measured width, not manufacturing width** (§11.2).
5. **Amber is used for the `deposit_received` badge**, reading the README's "don't reintroduce
   amber" as applying to the accent colour rather than semantic status badges (§3.2).
6. **`order_recorded` and `deposit_received` are counted in no dashboard tile** other than
   "Active orders"; no fifth tile is added (§3.4).
