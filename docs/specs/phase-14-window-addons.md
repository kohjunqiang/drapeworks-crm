# Phase 14 — Window add-ons & blinds-only toilets

**Status:** specified 2026-08-21 — not yet implemented
**Date:** 2026-08-21 (revised same day after review)
**Depends on:** Phase 9 (pricing foundation), Phase 10 (combos), Phase 12 (blinds), Phase 13B/13C (manufacture, procurement)

---

## 1. Why

Two changes that have to land together, because the first is what makes the second
clean.

**Add-ons are hard-coded, and it has already gone wrong.** `windows.add_s_fold` and
`windows.add_slim_tracks` are boolean columns threaded by name through twelve files —
schema, Zod, form, live quote, order quote, COGS legs, summary cards. Meanwhile
`pricing_addons` — the table the admin **Pricing settings → Add-ons** screen edits —
was seeded in Phase 9 with a `blackout` row and a `blinds_surcharge` row that **nothing
has ever read**. An admin can open that screen today, carefully price blackout, save it,
and change nothing whatsoever.

That is not hypothetical. The live table shows two rows whose `basis` has been flipped
since seeding (`blinds_surcharge` seeded `per_unit`, now `per_metre` at ¥0/S$0;
`single_track` seeded `per_unit`, now `per_metre`). The screen has been used to edit
rows nothing consumes. The list of things we charge for is business configuration; it is
currently a schema migration, and the gap between the two has been quietly filling with
edits that do nothing.

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
| Blinds surcharge | blind | per metre | by hand — **unpriced, so not yet offered**; see below |
| Extra shipping *(new)* | blind | per unit | **automatically when width > 200 cm** — once priced |

Adding a sixth — motorisation, a valance, whatever comes next — is a row on the admin
screen. Not a migration.

**Extra shipping is required, not suggested.** A blind wider than 2 m ships in a
non-standard carton and we pay for it. Above 200 cm the checkbox is ticked and locked:
the consultant cannot quote that blind without the cost. At or below 200 cm it is an
ordinary optional checkbox — 200 exactly is *not* over — because an awkward item may
still warrant it.

It ships **unpriced**, and by §4 rule 2 that means it does not appear until an admin gives
it a figure. This is deliberate: a locked checkbox adding S$0 is a mechanism that looks
finished and isn't. Pricing it is what arms the lock, and §7 is what tells the admin it's
waiting.

**Blinds surcharge ships inert, on purpose.** Its live values are ¥0 / S$0 / per metre,
which contradict both the Phase-9 seed (S$130, per unit) and the intent recorded when
this phase was scoped. Nobody currently knows which is right. Wiring it as an
always-applied charge in that state would be a landmine: the day an admin types a figure
into it, every subsequent blind re-prices while already-quoted ones do not, and because
the quote reads the persisted join rather than the resolver (§6.4) there is no staleness
signal to catch it. So it stays a by-hand row at whatever price it currently holds. An
admin switches it to **Always** deliberately, once they have decided what it is.

It does not render in the meantime. Its live price is ¥0 / S$0, and an add-on that
charges nothing is not offered — the same "don't offer what can't be quoted" rule that
hides an unpriced blind (§4 rule 2). A live checkbox reading "Blinds Surcharge" that adds
nothing when ticked is exactly the control §6.1 forbids. Pricing it is what makes it
appear.

Consequence worth stating: **no row ships with `auto_rule = 'always'`.** The value exists
for that admin switch and is tested (§8), but nothing exercises it in production on day
one.

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
create type pricing_addon_scope     as enum ('curtain', 'blind', 'both');
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
update public.pricing_addons set applies_to = 'blind' where key = 'blinds_surcharge';
-- blinds_surcharge keeps auto_rule = 'manual' (the default) and its current price.
-- See §2: its live values contradict the Phase-9 seed and nobody has confirmed which
-- is right, so it is not auto-applied until an admin decides.

insert into public.pricing_addons
  (key, label, cost_rmb_cents, sale_sgd_cents, basis, applies_to, auto_rule, auto_width_over_cm)
values
  ('extra_shipping', 'Extra shipping', null, null, 'per_unit', 'blind', 'width_over', 200);
```

`extra_shipping` ships **unpriced** (both money columns null). It costs nothing until an
admin prices it, which is the honest default — we are not inventing a figure — and §7
makes the admin screen say so out loud, because an auto-applied add-on worth S$0 is a
mechanism that looks like it works and doesn't.

`single_track` / `double_track` are `is_active = false` and stay on the existing
`RETIRED_KEYS` list in `lib/db/pricing-settings.ts`. That list is a *display* filter for
the admin loader; what keeps them out of the consultation form is `is_active` (§4).

**`down()`** drops the three columns, the check constraint and the two enums, deletes the
`extra_shipping` row, and reverts the two `applies_to` updates.

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
with it. `on delete restrict` from addons: an add-on in use cannot be hard-deleted —
though since add-ons are archived rather than deleted, the case that actually matters is
archival, handled by the resolver in §4.

**Prices are not snapshotted onto the join row.** They are read live at quote time,
exactly as series prices are, so an admin's price correction propagates the same way it
does everywhere else in this system and the staleness machinery keeps its meaning.
`quote-staleness.ts` needs no change; `stale-flags.ts` does need the join, for the reason
given in §6.4.

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

The trigger is rewritten **before** the column is dropped — the ordering
`20260817090000`'s `down()` calls out explicitly, for the same reason: a body that names
a column that no longer exists is not something to leave lying around mid-migration.

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

Then:

```sql
alter table public.windows drop column curtain_type_id;
```

0 rows use it. `down()` re-adds it as a nullable FK to `curtain_types` and restores the
previous trigger body.

Two behavioural changes to note. `curtain_type_id` no longer exists, so its guards go.
And **`draw` is now permitted on a toilet window that has no blind picked yet** — the
old body banned `draw` in a toilet room for any non-blind window, which was correct when
a toilet window meant a curtain (a single curtain has no pull direction) and is wrong
now that it means a half-filled blind. A toilet *blind* with `draw` set was already
accepted, because the old body returns early on `blind_type_id is not null`
(`20260817090000_product_line_and_blinds.ts:59–67`); the draft state is the case that
actually changes, and §8 tests that one.

A window with nothing picked stays valid — drafts depend on it.

`po_type_labels` keeps its `'toilet'` row and its
`key in ('day','night','toilet','blind','mesh')` check constraint. Nothing writes that
key after this phase (`actions/procurement.ts:153` is update-only), so removing the row
would be a hard delete for no benefit.

### 3.5 After the migrations

Run `npm run db:codegen` to regenerate `src/lib/db/schema.ts`.

## 4. The resolution rule

One exported function is the single source of truth for **deciding** a window's add-ons.
It is called by the form and by the Server Actions on every write path. It is **not**
called by the order quote: once written, the persisted join rows are the truth (§6.4).

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
  isActive: boolean;
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
  catalogue: readonly AddonRule[],
): ResolvedAddon[];
```

**The catalogue is every `pricing_addons` row — unfiltered.** It is loaded once per order
(§6.7), so it cannot be composed per window; the filtering is the resolver's job, which
is why `AddonRule` carries `isActive` at all. Any filtering done at load time would be
filtering the resolver can no longer undo.

Rules, in order:

1. **Scope.** Drop any add-on whose `appliesTo` is neither `covering` nor `'both'`. This runs **first**, so a curtain add-on left on a window switched to blind is dropped before any later rule can preserve it.
2. **Nothing to offer.** Drop any add-on that is **not already selected** on this window and is either `!isActive` or charges nothing (cost and sale both null-or-zero). This is the project's "don't offer what can't be quoted" rule — the same one that hides unpriced blinds and unpriced mesh — applied to add-ons. It is what keeps the retired `single_track` / `double_track` rows out of the form (`RETIRED_KEYS` does not reach here), and what keeps `blinds_surcharge` and an unpriced `extra_shipping` from rendering as checkboxes that charge nothing (§2, §7).
3. **`always`** → `selected: true, locked: true`.
4. **`width_over`** → when `widthCm != null && widthCm > autoWidthOverCm`, `selected: true, locked: true`. Otherwise it falls through to (5) and behaves as an ordinary checkbox, so a consultant can still tick it deliberately on a narrower but awkward item.
5. **`manual`**, and any `width_over` that did not trigger → `selected: selectedIds.includes(id), locked: false`.

**An already-selected add-on survives rule 2 and stays un-tickable, not locked.** Archiving
an add-on — or zeroing its price — must not silently drop the charge from windows already
carrying it, because the next edit's delete-then-insert (§6.3) would make that loss
permanent. So it renders as an ordinary checkbox the consultant *can* clear. Once cleared
it is no longer selected, rule 2 drops it, and it cannot come back. Locking it in both
directions would mean an add-on the business has retired can never be taken off a window,
which is the opposite of the intent.

An unmeasured window (`widthCm == null`) never triggers `width_over` — there is nothing
to compare. It becomes locked the moment a width over 200 is typed.

The output order is the catalogue order (`is_active desc, label asc`), so the checkboxes
don't reshuffle as a window is edited.

### 4.1 Which width, and why it never changes after the quote

`width_over` reads the **measured** width, not the manufacturing width.

The manufacturing width only exists after Phase-13B reconciliation, which happens once
the order is locked. Keying an auto-applied charge off it would mean a window measured at
195 and manufactured at 210 acquires a charge after the customer was quoted. The measured
width is what the customer was quoted on, and the sale side must not move afterwards.

The accepted consequence: a blind whose *manufacturing* width crosses 200 while its
measured width did not never picks up extra shipping. That is a cost-side surprise, and
cost-side surprises at manufacture are exactly what the existing reconciliation step is
for. It is not corrected by re-ticking a checkbox on a locked order.

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

### 5.1 No covering, no add-on

**A window that resolves to `offering: "none"` takes no add-ons at all.** The loop is
skipped in both branches.

This is load-bearing, not defensive. `windowQuote` branches on `win.blindPrice`, not on
the variant, and `blind_type_id` is optional — so a blind window with no type picked yet
falls through to the *curtain* path, carrying blind-scoped add-ons the resolver has
already decided on. Without this rule a window with no covering at all charges a per-unit
surcharge and reports `offering: "none"`. The same latent hole exists on the curtain
side; it is invisible today only because every add-on in the catalogue is `per_metre`,
and `addonLeg()` returns zero when width is null. `extra_shipping` is the first
`per_unit` add-on and would expose it immediately.

Fixing it in the calculator rather than the resolver is deliberate: the resolver answers
"what may this window carry", the calculator answers "what does this window cost", and
only the calculator knows whether a covering was resolved at all.

Note the guard's exact reach. `offering` for a blind is `measured ? "blind" : "none"`, and
`rowToCalcWindow` takes the blind branch whenever *either* price column is non-null — so a
**measured blind priced at ¥0/S$0 still takes add-ons.** `offering` reports whether a
covering was measured, not whether it was worth anything. That state is unreachable
through the form (§4 rule 2 keeps unpriced blinds out of the picker), so this is a
documented edge rather than a second guard.

### 5.2 Preserved behaviours

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

### 5.3 A blind can now have more than one leg

`calculator.ts:433` currently reads *"One covering, so the window IS its leg:
`computeQuote` drops a lone leg rather than printing the same figure twice."* With an
add-on applied that stops being true, and `computeQuote`'s `legs.length > 1` guard
(`:709`) starts emitting the `Blind` line alongside the add-on lines. **That is intended**
— a blind with blackout should show what it's made of — but the comment must be updated
to say so rather than left asserting the opposite.

## 6. Application surfaces

### 6.1 Consultation form

`window-fields.tsx` loses its `isToilet` branch entirely (lines 281–339). Two branches
remain: blind and regular.

- The **add-ons row** (currently lines 406–424, regular-only) becomes a shared component rendered by both branches, driven by `resolveWindowAddons`. It renders nothing at all when the resolved list is empty, rather than an "Add-ons:" label with no checkboxes.
- A **locked** checkbox renders ticked with a hint — `Extra shipping — required over 200 cm`. It must **not** use the `disabled` attribute: React Hook Form drops disabled fields from submitted values, which would lose the very charge the lock exists to guarantee. `readOnly` is inert on a checkbox, so it is not the answer either. Use `pointer-events-none` (mouse), `tabIndex={-1}` (keyboard) and `aria-disabled` (assistive tech) on a normally-registered input. The server re-resolve in §6.3 is the actual guarantee; this is only about not showing the consultant a control that lies.
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

The browser lock is UX. **All three window-insert paths** re-run `resolveWindowAddons`
server-side against the freshly-read catalogue and persist **the resolved set**, not the
submitted set:

| Path | Location | Note |
|---|---|---|
| `createOrder` | guard `orders.ts:102`, insert `:111` | |
| `updateOrder` | guard `orders.ts:236` | delete-then-insert, scoped to the windows being written, inside the existing transaction |
| `createOrderDraft` | shaping `orders.ts:483`, insert `:492` | easy to miss — it has its own window insert and its own variant shaping |

A hand-crafted POST that omits `extra_shipping` on a 230 cm blind gets it charged anyway;
one that adds a curtain-scoped add-on to a blind has it dropped. Drafts resolve too:
they are relaxed about *completeness*, never about *correctness of charge*.

The room/variant agreement checks (`orders.ts:102`, `:236`) become:

```ts
const ok = isToilet ? win.variant === "blind"
                    : win.variant === "regular" || win.variant === "blind";
```

and `createOrderDraft`'s shaping at `orders.ts:483` maps a toilet room to `"blind"`, not
`"toilet"`. Blinds remain valid in every room; only curtains are now excluded from
toilets. The existing locked-order guards are unchanged and already cover the child
write.

### 6.4 Quote loading — the persisted set is the truth

`order-quote.ts` **joins `window_addons → pricing_addons` and uses exactly those rows.**
It does not re-run the resolver. A quote must reproduce what was agreed, not what the
current rules would decide; re-resolving at read time would let a threshold edit silently
re-price a saved order.

It also drops `toilet_cost` / `toilet_sale` / `toilet_series` and the toilet branch at
`:393–406`, drops the `add_s_fold` / `add_slim_tracks` columns, and deletes
`toAddon("s_fold")` / `toAddon("slim_tracks")` and every `CalcAddonBook` construction —
`:107`, `:448`, and `addonRowsToBook` at `:726`, which is the one it is easiest to leave
behind.

**The join must land on every select, not just the quote ones.** `rowToCalcWindow`
(`:369`) is the shared mapper, called from `:578` (order quote) and `:733` (stale flags),
and it now has to produce `CalcWindow.addons`. Miss the join on the stale-flags select and
that path computes every add-on-carrying window *without* its add-ons — flagging orders as
stale that aren't, silently, on a screen nobody would think to distrust.

Rather than relying on remembering, **pass the window's add-on rows into
`rowToCalcWindow` as a second argument.** Then a call site that hasn't loaded them is a
type error rather than a wrong number.

`live-quote.tsx` drops its `isToilet` mapping (`:92–95`) and resolves add-ons from the
form's `addon_ids` against the catalogue passed in from the server component — the form
is the one place the resolver *does* run on read, because the form is where the decision
is being made.

### 6.5 Hydration — the edit path must load what it will overwrite

`updateOrder` delete-then-inserts the resolved set, so **anything the edit form fails to
load, it deletes.** `orders/[orderId]/edit/page.tsx` currently hydrates the two booleans
at `:352–353`; it must instead load each window's selected `addon_ids` from
`window_addons` into `defaultValues`. Without this every edit submits `addon_ids: []` and
wipes the window's add-ons — silently, and permanently.

### 6.6 Procurement, manufacture, display

- `lib/po/load.ts`: remove the `toilet_ct` / `toilet_cs` joins and the `w.toilet_label` line branch (`:376–382`). `PO_TYPE_KEYS` in `validation/procurement.ts` drops `"toilet"`.
- `lib/manufacture/load.ts`: remove the `toilet_ct` / `toilet_cs` joins and the `curtain_label` / `curtain_index` / `curtain_page` / `curtain_series` selects.
- `lib/po/track-order-load.ts`: a toilet window no longer contributes a rail — it's a blind, and blinds carry their own headrail. Update the comment at `:92` and the count.
- `room-summary-card.tsx`: delete the toilet branch (`:104`, `:115`); list a window's add-ons by label from the join rather than the two hard-coded names.
- `orders/[orderId]/page.tsx`: same substitution.

### 6.7 Catalogue plumbing — one loader, both surfaces

`CalcConfig.book` (the `{ sFold, slimTracks }` pair) is replaced by
`CalcConfig.addonCatalogue: AddonRule[]`, built by `loadCalcConfig`
(`order-quote.ts:76`). Its select currently reads
`["key", "cost_rmb_cents", "sale_sgd_cents", "basis"]` (`:84`) and must add `id`,
`label`, `is_active`, `applies_to`, `auto_rule` and `auto_width_over_cm`. **`is_active` in
particular**: without it the resolver cannot apply §4 rule 2, and the retired track rows
come back as curtain checkboxes — restoring the double-charge that `202608201000`
removed.

Both form entry points already call `loadCalcConfig` — `orders/new/page.tsx:94` and
`orders/[orderId]/edit/page.tsx:279` — so putting the catalogue there means both get it
without a new prop, and neither can be forgotten. It also guarantees the form and the
Server Action resolve against **the same rows**, which is what keeps the live quote and
the saved quote agreeing.

## 7. Admin UI

`components/pricing/addons-table.tsx` gains three controls per row and one button:

| Control | Notes |
|---|---|
| **Applies to** | select: Curtains / Blinds / Both |
| **Auto** | select: By hand / Always / Over width |
| **Over (cm)** | number, rendered **only** when Auto is "Over width"; required then |
| **+ Add add-on** | appends a blank row |

**Charges-nothing warning.** Any **active** row whose cost and sale are both null-or-zero
gets an inline warning — *"charges nothing, so it isn't offered on consultations"* — with
a stronger variant when `auto_rule <> 'manual'`, because an auto-applied add-on worth
nothing is a mechanism that looks finished and isn't.

The test is null **or zero**, and it does not depend on `auto_rule`. Both traps are live
today: `extra_shipping` ships null/null and automatic, while `blinds_surcharge` sits at
0/0 and manual. A warning keyed only on nulls, or only on automatic rows, would miss one
of them each — and this screen is the only place either becomes visible, since §4 rule 2
keeps both off the consultation form until they are priced.

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
- `always` → selected and locked regardless of width, including unmeasured *(no shipped row uses this — the test is what keeps the admin switch honest)*
- `width_over`: **199 unlocked, 200 unlocked, 201 locked** — the boundary is the point
- below-threshold `width_over` is still tickable by hand
- unmeasured window never auto-locks
- an archived add-on already selected on the window survives, and is **un-tickable** — clearing it drops it, and it does not come back
- an archived add-on **not** selected never appears
- an active add-on charging 0/0 never appears; the same add-on, already selected, survives
- an unpriced (null/null) `width_over` add-on never appears, however wide the window
- retired `single_track` / `double_track` (inactive, unselected) never appear even though the catalogue is unfiltered
- **scope beats survival:** a curtain add-on that is selected on a window switched to blind is dropped by rule 1, not preserved by the already-selected exception
- output order is stable

Unit — calculator:

- **`offering: "none"` takes no add-ons** — a blind window with an always-add-on and no type picked costs zero, and the same for a per-unit add-on on an empty curtain window
- a blind with a per-unit add-on, and with a per-metre add-on
- add-on cost excluded from `curtainCostRmbCents` for a blind (air-freight base unchanged)
- blind + combo id → combo ignored, add-ons still applied
- curtain + combo → sale overridden, add-on cost still in COGS
- one leg per add-on; zero-cost legs filtered; a blind with an add-on emits both its own leg and the add-on's
- blinds still take no style multiplier and no track

Integration:

- `createOrder` forces `extra_shipping` onto a 230 cm blind whose payload omitted it
- `createOrder` strips a curtain-scoped add-on submitted against a blind
- `createOrderDraft` writes add-ons and shapes a toilet room's window as `blind`
- **edit round-trip: create with add-ons → load the edit page → submit unchanged → add-ons survive** (the §6.5 regression)
- `updateOrder` round-trips add-on changes; a locked order still refuses the edit
- a toilet room rejects a `regular` window; accepts a `blind`
- the shape trigger accepts a **toilet window with `draw` set and no blind picked** — the draft state, which the old body rejected
- **stale flags do not fire on an unchanged order carrying add-ons** — the `:733` path's regression, and the one that would otherwise pass every unit test while lying on screen
- `loadCalcConfig` returns inactive rows, so the resolver (not the query) is what excludes them

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
- **Re-resolving add-ons at reconciliation.** See §4.1 — the measured width decides, permanently.
- **Deciding what `blinds_surcharge` is.** §2 ships it inert. Whether it is S$130 per unit, ¥0, or redundant against `handyman_blinds_sgd_cents` is a pricing question for an admin, and the phase is designed so that answering it later is a row edit.
- **Migrating existing toilet-curtain windows.** There are none. If any appear before this ships, re-audit before running the migration.

## 10. Rollout

Order of operations:

1. Migration: `pricing_addons` columns + enums + constraint + seed.
2. Migration: `window_addons` + backfill + drop `add_s_fold` / `add_slim_tracks`.
3. Migration: rewrite `validate_window_shape()`, **then** drop `windows.curtain_type_id`.
4. `npm run db:codegen`.
5. Code, following §5–§7.
6. `npm run test` and `npm run build` (the build type-checks, and dropping three columns from `schema.ts` will surface every remaining reference).

Because this touches pricing, procurement and manufacturing in one pass on a database
with orders already in `sent_to_vendor`, verify end-to-end before merging:

- a curtain order quotes identically to before on a window with no add-ons — **no silent re-pricing**
- a toilet room offers blinds only, and its quote uses the blinds install rate
- **price `extra_shipping` on the admin screen first** — until then §4 rule 2 keeps it off the form entirely, and "a 230 cm blind can't be quoted without it" passes vacuously. Then: it appears, ticks itself, locks, and its figure reaches the quote
- editing a saved order and submitting it unchanged leaves its add-ons intact
- an order carrying add-ons is **not** flagged stale immediately after being saved
- PO generation still produces correct documents for an existing `sent_to_vendor` order
- the manufacture reconciliation grid still loads for that same order

The last two are the ones this change could plausibly break without anyone noticing.
