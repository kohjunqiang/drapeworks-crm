# Phase 14 — Window add-ons & blinds-only toilets

**Status:** specified 2026-08-21 — not yet implemented
**Date:** 2026-08-21
**Depends on:** Phase 9 (pricing foundation), Phase 10 (combos), Phase 12 (blinds), Phase 13B/13C (manufacture, procurement)

---

## 1. Why

Two changes that have to land together, because the first is what makes the second
clean.

**Add-ons are hard-coded, and it has already gone wrong.** `windows.add_s_fold` and
`windows.add_slim_tracks` are boolean columns threaded by name through twelve files —
schema, Zod, form, live quote, order quote, COGS legs, summary cards. Meanwhile
`pricing_addons` — the table the admin **Pricing settings → Add-ons** screen edits —
was seeded in Phase 9 with a `blackout` row (¥27/m, S$50/m) and a `blinds_surcharge`
row (S$130/unit) that **nothing has ever read**. An admin can open that screen today,
carefully price blackout, save it, and change nothing whatsoever. The list of things we
charge for is business configuration; it is currently a schema migration.

Blinds have it worse: `windowQuote` returns from its blind branch *before any add-on is
applied* (`calculator.ts:418`), deliberately, so a stale curtain flag can't charge a
blind. A blind can therefore carry no add-on at all. Blackout is a blind option we sell,
and a blind wider than 2 m physically cannot ship in a standard carton — that shipping
cost is real and currently invisible.

**A toilet window is a blind.** The `toilet` window variant models one *curtain* in a
toilet. That is no longer what the business sells: toilets take blinds. Keeping the
variant alive forces an awkward third case into the add-on scoping — a toilet curtain
would inherit S-Fold and Slim tracks, which are main-window curtain hardware — and
would need a fourth scope value existing solely to describe a product we don't sell.
Retiring it means there are exactly two coverings, and `curtain | blind | both` covers
them exactly.

### Why now, and why together

The database was audited on 2026-08-21 before this spec was written:

| | |
|---|---|
| Windows in total | **11** (9 day/night curtain, 2 blind) across 4 orders |
| Toilet-room windows | **0** |
| Windows using the single-curtain (`curtain_type_id`) shape | **0** |
| Windows with `add_s_fold` or `add_slim_tracks` set | **0** and 0 |
| Priced blind types available | 420, across 7 series |

There is no toilet-curtain data to migrate or strand, and the add-on backfill is a
no-op on real rows. The retirement will never be cheaper than it is now.

**Known risk, accepted.** This is one change across ~25 files spanning pricing,
procurement and manufacturing, landing on a system with three orders already in
`sent_to_vendor`. Splitting it into two sequenced phases was proposed and declined in
favour of a single pass. §10 lists the verification this therefore requires.

## 2. What changes commercially

**Any charge that isn't the covering itself is an add-on**, and add-ons are a list an
admin maintains. Each one carries a ¥ cost and an S$ sale price, is charged per metre of
width or per unit, applies to curtains, blinds or both, and is either ticked by hand or
applied automatically.

The list this phase ships with:

| Add-on | Applies to | Charged | How it's applied |
|---|---|---|---|
| S-Fold | curtain | per metre | by hand |
| Slim tracks | curtain | per metre | by hand |
| Blackout | **both** | per metre | by hand |
| Blinds surcharge | blind | per unit | **always** |
| Extra shipping *(new)* | blind | per unit | **automatically when width > 200 cm** |

Adding a sixth — motorisation, a valance, whatever comes next — is a row on the admin
screen. Not a migration.

**Extra shipping is required, not suggested.** A blind wider than 2 m ships in a
non-standard carton and we pay for it. Above 200 cm the checkbox is ticked and locked:
the consultant cannot quote that blind without the cost. At or below 200 cm it is an
ordinary optional checkbox — 200 exactly is *not* over — because an awkward item may
still warrant it.

**Toilets take blinds.** A toilet room's windows are blind windows. No curtain is
offered there and the Curtains/Blinds toggle does not appear.

> **Pricing consequence, stated deliberately:** a toilet window now bills the blinds
> installation rate (`handyman_blinds_sgd_cents`) instead of the single-curtain rate
> (`handyman_single_sgd_cents`). If those two figures differ, toilet windows change
> price. This is correct — a blind is what's being installed — but it is a real change
> to quoted totals and should not surprise anyone.

## 3. Data model

### 3.1 `pricing_addons` gains three columns

Two new enums:

```sql
create type pricing_addon_scope    as enum ('curtain', 'blind', 'both');
create type pricing_addon_auto_rule as enum ('manual', 'always', 'width_over');
```

| Column | Type | Default | Meaning |
|---|---|---|---|
| `applies_to` | `pricing_addon_scope` | `'curtain'` | which covering offers this checkbox |
| `auto_rule` | `pricing_addon_auto_rule` | `'manual'` | how it gets ticked |
| `auto_width_over_cm` | `integer` null | `null` | threshold in cm; the width must **exceed** it |

Guarded by a check constraint, so the threshold and the rule cannot disagree:

```sql
alter table public.pricing_addons
  add constraint pricing_addons_auto_width_agrees
    check (
      (auto_rule = 'width_over' and auto_width_over_cm is not null and auto_width_over_cm > 0)
      or (auto_rule <> 'width_over' and auto_width_over_cm is null)
    );
```

The default of `'curtain'` is chosen so the two live add-ons (`s_fold`, `slim_tracks`)
land correctly without an update, and so a future row added by hand fails safe — visible
on curtains, never silently auto-charged.

Seed state, applied in the same migration:

```sql
update public.pricing_addons set applies_to = 'both'  where key = 'blackout';
update public.pricing_addons set applies_to = 'blind', auto_rule = 'always'
  where key = 'blinds_surcharge';

insert into public.pricing_addons
  (key, label, cost_rmb_cents, sale_sgd_cents, basis, applies_to, auto_rule, auto_width_over_cm)
values
  ('extra_shipping', 'Extra shipping', null, null, 'per_unit', 'blind', 'width_over', 200);
```

`extra_shipping` ships **unpriced** (both money columns null). It costs nothing until an
admin prices it, which is the honest default — we are not inventing a figure — and it
shows up on the settings screen as a blank waiting to be filled.

`single_track` / `double_track` stay on the existing `RETIRED_KEYS` list in
`lib/db/pricing-settings.ts` and are untouched.

### 3.2 `window_addons` — the join table

```sql
create table public.window_addons (
  window_id uuid not null references public.windows(id) on delete cascade,
  addon_id  uuid not null references public.pricing_addons(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (window_id, addon_id)
);
create index window_addons_addon_id_idx on public.window_addons (addon_id);
```

`on delete cascade` from windows: an add-on selection is part of the window and dies
with it. `on delete restrict` from addons: an add-on in use cannot be deleted, which is
consistent with the no-hard-deletes rule (add-ons are archived via `is_active`, never
removed).

**Prices are not snapshotted onto the join row.** They are read live at quote time,
exactly as series prices are, so `quote-staleness.ts` and `stale-flags.ts` keep working
unchanged and an admin's price correction propagates the same way it does everywhere
else in this system.

RLS: mirror the `windows` policies — authenticated read; write for the owning consultant
or an admin, and refused when `public.order_is_locked(...)` via the parent window's
room. Per `rules/data/rls.md` the policy is written but not relied upon; the Server
Actions are the enforcement surface (§6.3).

### 3.3 Backfill, then drop the boolean columns

```sql
insert into public.window_addons (window_id, addon_id)
select w.id, a.id from public.windows w
  join public.pricing_addons a on a.key = 's_fold'
 where w.add_s_fold
union all
select w.id, a.id from public.windows w
  join public.pricing_addons a on a.key = 'slim_tracks'
 where w.add_slim_tracks;

alter table public.windows drop column add_s_fold, drop column add_slim_tracks;
```

The backfill affects 0 rows today but must be written correctly regardless — the
migration may run against a database that has moved on. Dropping the columns is the
point: leaving them creates two sources of truth for the same fact, which is how
`blackout` became dead config in the first place. `down()` re-adds the columns and
reverses the backfill before dropping the table.

### 3.4 Retiring the toilet curtain

```sql
alter table public.windows drop column curtain_type_id;
```

0 rows use it. `down()` re-adds it as a nullable FK to `curtain_types`.

The `validate_window_shape()` trigger is rewritten. Note the two behavioural changes:
`curtain_type_id` no longer exists, and **`draw` is now permitted in a toilet room** —
it carries a blind's chain/control side, which the old body banned outright.

```sql
create or replace function public.validate_window_shape() returns trigger
language plpgsql as $$
declare
  v_room_type public.room_type;
begin
  -- A blind window carries no curtain. Valid in every room, toilets included.
  if new.blind_type_id is not null then
    if new.day_curtain_type_id is not null or new.night_curtain_type_id is not null then
      raise exception 'blind windows must not have a curtain type';
    end if;
    return new;
  end if;

  -- No blind picked: a curtain window, or an empty one still being filled in.
  select type into v_room_type from public.rooms where id = new.room_id;
  if v_room_type in ('Master Toilet', 'Common Toilet')
     and (new.day_curtain_type_id is not null or new.night_curtain_type_id is not null) then
    raise exception 'toilet windows take a blind, not a curtain';
  end if;
  return new;
end
$$;
```

A window with nothing picked stays valid — drafts depend on it.

`po_type_labels` keeps its `'toilet'` row and its
`key in ('day','night','toilet','blind','mesh')` check constraint. Nothing writes that
key after this phase; removing the row would be a hard delete for no benefit.

### 3.5 After the migrations

Run `npm run db:codegen` to regenerate `src/lib/db/schema.ts`.

## 4. The resolution rule

One exported function is the single source of truth, used by the live quote, the server
quote, the form and the Server Actions. Everything else reads its output.

```ts
// src/lib/orders/window-addons.ts
export type AddonRule = {
  id: string;
  key: string;
  label: string;
  costRmbCents: number | null;
  saleSgdCents: number | null;
  basis: "per_metre" | "per_unit";
  appliesTo: "curtain" | "blind" | "both";
  autoRule: "manual" | "always" | "width_over";
  autoWidthOverCm: number | null;
};

export type ResolvedAddon = AddonRule & {
  /** Ticked, whether by the consultant or by the rule. */
  selected: boolean;
  /** The rule decided it; the consultant cannot change it. */
  locked: boolean;
};

export function resolveWindowAddons(
  covering: "curtain" | "blind",
  widthCm: number | null,
  selectedIds: readonly string[],
  catalogue: readonly AddonRule[],   // active add-ons only
): ResolvedAddon[];
```

Rules, in order:

1. **Scope.** Drop any add-on whose `appliesTo` is neither `covering` nor `'both'`.
2. **`always`** → `selected: true, locked: true`.
3. **`width_over`** → when `widthCm != null && widthCm > autoWidthOverCm`, `selected: true, locked: true`. Otherwise it falls through to (4) and behaves as an ordinary checkbox, so a consultant can still tick it deliberately on a narrower but awkward item.
4. **`manual`**, and any `width_over` that did not trigger → `selected: selectedIds.includes(id), locked: false`.

An unmeasured window (`widthCm == null`) never triggers `width_over` — there is nothing
to compare. It becomes locked the moment a width over 200 is typed.

The output order is the catalogue order (`is_active desc, label asc`), so the checkboxes
don't reshuffle as a window is edited.

## 5. Calculator

`CalcAddonBook` — the `{ sFold, slimTracks }` struct — is deleted. `CalcWindow` instead
carries the already-resolved list:

```ts
export type CalcWindow = BreakdownIdentity & {
  // ...
  addons: { label: string; costRmbCents: number | null;
            saleSgdCents: number | null; basis: "per_metre" | "per_unit" }[];
  // addSFold / addSlimTracks removed
};
```

`windowQuote` loops over `win.addons`, calling the existing `addonLeg()` once each and
pushing one `CogsLeg` per add-on, replacing the two hand-written blocks at
`calculator.ts:487–501`. Zero-cost legs are still filtered by `charged()`, so an unpriced
`extra_shipping` adds no noise to the breakdown.

The blind branch stops returning early: it resolves its own add-ons the same way. Four
existing behaviours are preserved **deliberately**, and each needs a test that says so:

- A blind takes **no style multiplier** — that models gathered fabric, and a blind hangs flat.
- A blind takes **no track** — it carries its own headrail.
- A blind **ignores `comboPriceSgdCents`** — a combo is a curtain bundle.
- Add-on **cost stays out of `curtainCostRmbCents`**, the air-freight base, for blinds exactly as it already does for curtains. A blind's air-freight base remains its `blindLeg` cost alone.

And one that is unchanged but now applies more widely: **a combo still overrides sale
while add-on cost still counts.** Tick S-Fold on a combo window and the customer pays the
bundle price while COGS carries the S-Fold. That is existing behaviour and it stays; the
margin is meant to be genuine.

## 6. Application surfaces

### 6.1 Consultation form

`window-fields.tsx` loses its `isToilet` branch entirely (lines 281–339). Two branches
remain: blind and regular.

- The **add-ons row** (currently lines 406–424, regular-only) becomes a shared component rendered by both branches, driven by `resolveWindowAddons`. It renders nothing at all when the resolved list is empty, rather than an "Add-ons:" label with no checkboxes.
- A **locked** checkbox renders ticked, visually disabled and non-interactive, with a hint — `Extra shipping — required over 200 cm`. It must **not** use the `disabled` attribute: React Hook Form drops disabled fields from submitted values, which would silently lose the very charge the lock exists to guarantee. Use `readOnly` plus `pointer-events-none` and `aria-disabled`, keeping the input registered.
- **`CoveringToggle` is hidden in toilet rooms** — there is nothing to toggle to.
- `setCovering` clears add-ons that no longer apply after a switch, mirroring how day/night selections are already cleared.
- **Empty state:** a toilet room with no priced blind in the catalogue has nothing to offer, and the hidden toggle means the existing `stranded` message in `CoveringToggle` can no longer surface it. The blind branch shows its own explanatory message in place of an empty picker — the "don't offer what can't be quoted" rule.

`room-card.tsx` (`targetVariant`) and `consultation-form/index.tsx` (`blankWindow`) both
map a toilet room to `variant: "blind"` instead of `"toilet"`.

### 6.2 Validation

`validation/order.ts`:

- `toiletWindow` and `toiletWindowEdit` are deleted; `windowSchema` and `windowEditSchema` become two-member unions (`regular | blind`).
- `curtain_type_id` is removed from every schema including `draftWindow`.
- `add_s_fold` / `add_slim_tracks` are replaced on `baseWindow` by `addon_ids: z.array(z.string().uuid()).default([])`, so both remaining variants and the draft shape carry it uniformly.
- `isToiletRoom()` stays — it now means "this room's windows are blinds".

`window-values.ts`: `WindowLike.variant` drops `"toilet"`, the toilet branch goes, and
`curtain_type_id` / `add_s_fold` / `add_slim_tracks` leave `WindowColumnValues`. Add-on
ids are **not** part of `windowValues` — they are a separate table, written by the
action after the window row.

### 6.3 Server Actions — where the lock is actually enforced

The browser lock is UX. `createOrder` and `updateOrder` in `lib/actions/orders.ts`
re-run `resolveWindowAddons` server-side against the freshly-read catalogue and persist
**the resolved set**, not the submitted set. A hand-crafted POST that omits
`extra_shipping` on a 230 cm blind gets it charged anyway; one that adds a
curtain-scoped add-on to a blind has it dropped.

The room/variant agreement checks (`orders.ts:102`, `:236`) become:

```ts
const ok = isToilet ? win.variant === "blind"
                    : win.variant === "regular" || win.variant === "blind";
```

Blinds remain valid in every room; only curtains are now excluded from toilets. The
existing locked-order guards are unchanged and already cover the child write.

Writing add-ons on update is delete-then-insert within the existing transaction, scoped
to the windows being written.

### 6.4 Quote loading

`order-quote.ts` drops `toilet_cost` / `toilet_sale` / `toilet_series` and the toilet
branch at `:393–406` from all three of its selects, drops the `add_s_fold` /
`add_slim_tracks` columns, and joins `window_addons → pricing_addons` to build each
window's `addons`. `toAddon("s_fold")` / `toAddon("slim_tracks")` and the `CalcAddonBook`
construction at `:107` and `:448` are deleted.

`live-quote.tsx` drops its `isToilet` mapping (`:92–95`) and resolves add-ons from the
form's `addon_ids` against the catalogue passed in from the server component.

### 6.5 Procurement, manufacture, display

- `lib/po/load.ts`: remove the `toilet_ct` / `toilet_cs` joins and the `w.toilet_label` line branch (`:376–382`). `PO_TYPE_KEYS` in `validation/procurement.ts` drops `"toilet"`.
- `lib/manufacture/load.ts`: remove the `toilet_ct` / `toilet_cs` joins and the `curtain_label` / `curtain_index` / `curtain_page` / `curtain_series` selects.
- `lib/po/track-order-load.ts`: a toilet window no longer contributes a rail — it's a blind, and blinds carry their own headrail. Update the comment at `:92` and the count.
- `room-summary-card.tsx`: delete the toilet branch (`:104`, `:115`); list a window's add-ons by label from the join rather than the two hard-coded names.
- `orders/[orderId]/page.tsx` and `edit/page.tsx`: same substitution; both must pass the add-on catalogue down.

## 7. Admin UI

`components/pricing/addons-table.tsx` gains three controls per row and one button:

| Control | Notes |
|---|---|
| **Applies to** | select: Curtains / Blinds / Both |
| **Auto** | select: By hand / Always / Over width |
| **Over (cm)** | number, rendered **only** when Auto is "Over width"; required then |
| **+ Add add-on** | appends a blank row |

A new row's `key` is slugged from its label (`Extra Shipping` → `extra_shipping`);
uniqueness is enforced by the existing unique index and surfaced as a field error, not a
thrown 500. A blank label cannot be saved.

The row layout already wraps on mobile (`flex flex-wrap`); the new controls follow the
same pattern. Existing archive/reactivate behaviour is untouched.

`validation/pricing-settings.ts` gains the three fields with the same cross-field rule as
the check constraint: `auto_width_over_cm` is required when `auto_rule = 'width_over'`
and must be absent otherwise.

## 8. Tests

Unit — `resolveWindowAddons`:

- scope filtering: a curtain-scoped add-on never appears on a blind, `both` appears on each
- `always` → selected and locked regardless of width, including unmeasured
- `width_over`: **199 unlocked, 200 unlocked, 201 locked** — the boundary is the point
- below-threshold `width_over` is still tickable by hand
- unmeasured window never auto-locks
- output order is stable

Unit — calculator:

- a blind with a per-unit add-on, and with a per-metre add-on
- add-on cost excluded from `curtainCostRmbCents` for a blind (air-freight base unchanged)
- blind + combo id → combo ignored, add-ons still applied
- curtain + combo → sale overridden, add-on cost still in COGS
- one leg per add-on; zero-cost legs filtered
- blinds still take no style multiplier and no track

Integration:

- `createOrder` forces `extra_shipping` onto a 230 cm blind whose payload omitted it
- `createOrder` strips a curtain-scoped add-on submitted against a blind
- `updateOrder` round-trips add-on changes; a locked order still refuses the edit
- a toilet room rejects a `regular` window; accepts a `blind`
- the shape trigger accepts a toilet blind **with `draw` set** (the old body banned it)

Migration:

- backfill maps `add_s_fold` → the `s_fold` row and `add_slim_tracks` → `slim_tracks`
- `down()` restores the columns and the flags
- the check constraint rejects `width_over` with a null threshold, and `manual` with a threshold

Existing suites that reference `add_s_fold`, `add_slim_tracks`, `curtain_type_id` or the
`toilet` variant (`window-values.test.ts`, `order.test.ts`, `calculator.test.ts`) are
updated rather than deleted — each assertion should survive in its new form.

## 9. Out of scope

- **Mesh add-ons.** Mesh has its own per-panel surcharge model (`mesh-calculator.ts`) and is untouched.
- **Per-order add-ons.** Everything here is per window.
- **Quantity.** An add-on is on or off, never ×2.
- **Migrating existing toilet-curtain windows.** There are none. If any appear before this ships, re-audit before running the migration.
- **Retiring `blinds_surcharge` against `handyman_blinds_sgd_cents`.** These were confirmed as separate charges. If they turn out to double-count, that is a pricing correction, not this phase.

## 10. Rollout

Order of operations:

1. Migration: `pricing_addons` columns + enums + constraint + seed.
2. Migration: `window_addons` + backfill + drop `add_s_fold` / `add_slim_tracks`.
3. Migration: drop `windows.curtain_type_id` + rewrite `validate_window_shape()`.
4. `npm run db:codegen`.
5. Code, following §5–§7.
6. `npm run test` and `npm run build` (the build type-checks, and dropping three columns from `schema.ts` will surface every remaining reference).

Because this touches pricing, procurement and manufacturing in one pass on a database
with orders already in `sent_to_vendor`, verify end-to-end before merging:

- a curtain order quotes identically to before on a window with no add-ons — **no silent re-pricing**
- a toilet room offers blinds only, and its quote uses the blinds install rate
- a 230 cm blind cannot be quoted without extra shipping
- PO generation still produces correct documents for an existing `sent_to_vendor` order
- the manufacture reconciliation grid still loads for that same order

The last two are the ones this change could plausibly break without anyone noticing.
