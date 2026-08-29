# Phase 16 — Lead funnel redesign

**Status:** Implemented 2026-08-29. Database deployment pending explicit production migration approval.
**Supersedes:** the funnel model in `phase-15-leads-and-appointments.md` (the engine, the
three PG enums, the `/leads` two-tab screen). Phase 15's appointments, Google Calendar
sync, customer matching and `/orders/new` seam are **kept as-is** and only re-pointed at
the new vocabulary.

---

## Why

Phase 15 ported Alan's `02 Leads Management & Appt.xlsx` verbatim — same vocabularies,
same 16-branch cascade, same three known spreadsheet bugs. That was the right call then:
porting faithfully is what let 244 imported rows be diffed against the sheet. A week of
real use has now exposed the structural problem the spreadsheet always had.

**Too many fields answer the same question.**

| Question | Fields that currently answer it |
|---|---|
| How commercially ready is this lead? | Funnel Stage, Lead Status, Contact Priority, Buying Readiness |
| What do I do next? | Action Required, Next Action, Effective Action Date |
| When? | Action Date, Effective Action Date, Due Status, Contact Priority |

Every conversation costs the user seven manual edits across overlapping fields, and the
model permits states that are simply wrong.

**The arithmetic proves it.** 41 Won + 54 Lost + 106 Not Qualified = **201 of 244 leads
sit in a terminal stage.** Of those 201, **141 carry a `lead_status` that is not closed at
all** — 113 `Unresponsive`, 26 `Active`, 2 `Nurture`. Only 43 leads are genuinely open.
Separately, 106 leads derive `Ignore Lead`, an action the dashboard tallies nowhere, and
one of them leaks into the daily queue.

(Counts here and throughout are computed from `__fixtures__/spreadsheet-parity.json`,
which holds all 244 imported rows.)

This phase replaces the ported model with a single readiness axis and a strict hierarchy:

```
Funnel Stage          where is this opportunity?          human
  → Lead Status       is it alive, ghosting, or closed?   derived
  → Last Contact Outcome   what just happened?            human
    → Action Required      what should I do?              derived
      → Action Detail      what specifically?             human, free text
        → Next Action Date when?                          human
```

Plus the interaction log the follow-up automation needs, a Contact Channel / Lead Source
split for CAC analytics, and the Daily Queue promoted to its own route.

**The target:** after a normal conversation the user updates **outcome, action detail,
next action date** — and the stage only if the commercial stage actually moved.
Everything else derives.

---

## Scope

**In.** New funnel/status/outcome vocabularies. Derived Lead Status. Rewritten Action
Required. Interaction log + automated follow-up counting. Contact Channel vs Lead Source.
Keys/move-in restructure. Primary product. Closure reason. Ownership derivation. Quote
sent/validity. Recommendation banners. `/queue` route. `/leads` filters. Split
detail/edit pages. Migration of all 244 leads. Full test rewrite.

**Out.** Analytics dashboards (schema must *support* them; no screens built). WhatsApp /
Telegram ingestion. Customer dedup. Any change to orders, products, pricing or
procurement. Any change to Google Calendar behaviour beyond vocabulary.

---

## Decisions taken

| Question | Decision | Rationale |
|---|---|---|
| `'Qualified / Pre-Appointment'` (15 rows) maps to | `'Activate Lead – Short Term'` | Conservative. Over-promoting puts phantom urgency in the queue on the morning it must earn trust; under-promoting is a ten-minute manual pass. |
| Jay / Alan / Jason | All three are `profiles` rows | Current Owner derives from `profiles`; **no person's name appears in any derivation.** A `profiles.is_presales_owner` flag marks the pre-appointment default. |
| Lead Source backfill | `TG-*` → `'Telegram Group Buy'`, `WA-SEM*` → `'SEM'`, everything else `NULL` | Backfill only what the ref proves. `'Other'` would become a large bucket that silently pollutes conversion-by-source. |
| Structure | `/queue` first in nav; `/leads` is the database; `/leads/[id]/edit` splits out | Spec §21: the user must not work primarily from the leads database. |
| Lead Status storage | Stored column, trigger-maintained | Its inputs aren't today-dependent, the queue needs it in SQL, and a `BEFORE` trigger makes `Won + Active` *impossible* rather than merely unlikely. |
| Follow-up counter | Trigger on `lead_interactions`, not the server action | A counter maintained in app code desyncs on any other writer, and it gates queue visibility — drift silently *hides* leads. |
| Legacy values | Sidecar table `lead_legacy_import`, not `legacy_*` columns | See "Why a sidecar" below. |

---

## The model

### Vocabularies

All the en-dashes below are **U+2013**, matching house style (`'Exclude – Ghosted'`,
`'Contact in 2–3 Days'`). This matters — see Risk R3.

```
lead_funnel_stage   (PG enum, NOT NULL, default 'Qualify Lead')
  'Qualify Lead'
  'Nurture Lead – Long Term'
  'Activate Lead – Short Term'
  'Book Appointment'
  'Attend Appointment'
  'Send Quotation'
  'Collect Deposit'
  'Decision Pending'
  'Won'
  'Lost'
  'Not Qualified'

lead_status         (PG enum, NOT NULL, trigger-maintained — never written by the app)
  'Active' | 'Unresponsive' | 'Closed – Won' | 'Closed – Lost' | 'Closed – Not Qualified'

lead_outcome        (PG enum, nullable)
  'Customer Replied' | 'Awaiting Customer' | 'No Response'
  'Pre-Appointment Barrier' | 'Appointment Booked' | 'Quotation Sent'
  'Post-Appointment Barrier' | 'Customer Declined' | 'Customer Confirmed'

lead_contact_channel   'Telegram' | 'WhatsApp' | 'Other'
lead_source            'Telegram Group Buy' | 'SEM' | 'Organic' | 'Carousell'
                     | 'Referral' | 'Existing Customer' | 'Other'
lead_direction         'Inbound' | 'Outbound'
lead_primary_product   'Curtains / Blinds' | 'Mesh' | 'Both'
lead_closure_reason    'Competitor' | 'Price / Budget' | 'Ghosted'
                     | 'Small Order / Low Value' | 'Product Mismatch'
                     | 'Timing / No Longer Needed' | 'Communication / Poor Fit'
                     | 'Outside Scope' | 'Other'

interaction_direction  'Inbound' | 'Outbound'
interaction_type       'Customer Message' | 'Reply' | 'Follow-Up' | 'Appointment'
                     | 'Quote' | 'Payment' | 'Note'
```

**Derived only — TS unions, no PG enum, never stored:**

```ts
ActionRequired =
  | 'Reply Required' | 'Follow-Up' | 'Awaiting Customer'
  | 'Resolve Appointment Barrier' | 'Book Appointment'
  | 'Confirm / Attend Appointment' | 'Send Quotation' | 'Push for Deposit'
  | 'Push for Decision' | 'Resolve Closing Barrier'
  | 'Nurture Lead' | 'Activate Lead' | 'Qualify Lead' | 'Closed' | 'Won'

DueStatus = 'Overdue' | 'Due Today' | 'Upcoming' | 'No Date' | 'Closed'

BuyingReadiness = 'Low' | 'Medium' | 'High' | null
```

Two notes on the requirements as written:

1. The requirement lists 13 Action Required values; counted, the list is 14.
2. `'Awaiting Customer'` is **added as a 15th**. Its own rule — "before Next Action Date
   this can show *Awaiting Customer* or no urgent action" — needs a value to render.

`interaction_type` uses the short label `'Follow-Up'`, not
`'Follow-Up / Engagement Attempt'`. Enum labels are forever and this one is matched
exactly by the counter rule; the long phrasing is a UI label and belongs in the UI.

---

## The engine — `src/lib/leads/funnel-engine.ts`

Pure functions over a flat input struct. Imports only `./sg-date` and `./funnel-types`.
No DB access, no `lead_interactions` reads (see "Why the engine ignores the log").

```ts
export type FunnelEngineInput = {
  funnel_stage: FunnelStage;
  last_outcome: LeadOutcome | null;
  next_action_date: SgDate | null;
  unanswered_followups: number;
  move_in_date: SgDate | null;
  quotation_sent_at: SgDate | null;
  quote_valid_days: number;
  assigned_consultant_id: string | null;
  owner_id: string | null;
};
```

**Three date columns need an explicit conversion at the read seam**, and getting this
wrong is the `::text` class of bug `CLAUDE.md` warns about:

| column | PG type | how the page must read it |
|---|---|---|
| `next_action_date` | `date` | `sql<string \| null>\`leads.next_action_date::text\`` — node-pg returns `date` as a JS `Date` at *local* midnight |
| `move_in_date` | `date` | same `::text` cast |
| `quotation_sent_at` | `timestamptz` | **not** a `::text` cast — read the `Date` and pass it through `toSgDate()`, exactly as `last_customer_response_at` is handled at `leads/page.tsx` today |

`quotation_sent_at` stays `timestamptz` because the requirement asks for a date *and*
time and the analytics want the precision; the engine only ever needs the Singapore
calendar date, which is what `toSgDate()` gives it. This matters because it feeds
`quote_valid_until`, which drives the `quote-aged` recommendation — an eight-hour slip
there fires the recommendation a day early or late.

### `deriveLeadStatus(stage, unansweredFollowups)`

```
'Won'           → 'Closed – Won'
'Lost'          → 'Closed – Lost'
'Not Qualified' → 'Closed – Not Qualified'
unanswered_followups >= 2 → 'Unresponsive'
otherwise       → 'Active'
```

Terminal stages are checked **first**, so a closed lead can never read `Unresponsive`.
This same rule is implemented a second time in PL/pgSQL (see Migration 5); the two are
reconciled by `scripts/verify-derivations.ts`.

### `deriveActionRequired(lead, today)` — the cascade

**The terminal-stage guard sits ABOVE the outcome overrides. This ordering is
load-bearing.**

The requirement reads "outcome overrides stage … else stage decides". Implemented
literally on this dataset, **136 of the 201 terminal leads escape `'Closed'`/`'Won'`** and
derive a live action instead — the count of leads with an open action goes from 43 to 179.
A `'Won'` lead whose last outcome was `'Quotation Sent'` reads `Push for Deposit`.

They would not flood `/queue` — `lead_status` is stage-driven and checked terminal-first,
so the SQL filter still excludes them (see the fixture-pin note under Testing). But every
one renders a live action on its detail page and in `/leads`, `dueStatus` computes against
it, and any dashboard tallying by action is wrong by a factor of four. It is also one
schema change away from being a queue flood: the moment anything makes status
outcome-aware, 136 dead leads arrive at once.

The Phase-15 engine already gets this right (`queue-engine.ts:24-25`, with a comment
saying the order is load-bearing). Preserve the precedent.

```ts
export function deriveActionRequired(
  lead: FunnelEngineInput,
  today: SgDate,
): ActionRequired {
  const { funnel_stage: stage, last_outcome: outcome, next_action_date: date } = lead;

  // 1. Terminal stages. Above the outcome branches, deliberately.
  if (stage === "Won") return "Won";
  if (stage === "Lost" || stage === "Not Qualified") return "Closed";

  // 2. Terminal outcomes the stage has not caught up to yet.
  if (outcome === "Customer Confirmed") return "Won";
  if (outcome === "Customer Declined") return "Closed";

  // 3. The one date-gated branch.
  if (outcome === "Awaiting Customer") {
    if (date === null) return "Follow-Up";   // nothing scheduled = nothing protecting it
    return date > today ? "Awaiting Customer" : "Follow-Up";
  }

  // 4. Remaining outcome overrides — the customer put the ball back with us.
  if (outcome === "Customer Replied")         return "Reply Required";
  if (outcome === "No Response")              return "Follow-Up";
  if (outcome === "Pre-Appointment Barrier")  return "Resolve Appointment Barrier";
  if (outcome === "Post-Appointment Barrier") return "Resolve Closing Barrier";
  if (outcome === "Appointment Booked")       return "Confirm / Attend Appointment";
  if (outcome === "Quotation Sent")           return "Push for Deposit";

  // 5. Otherwise the stage decides the commercial objective.
  //    Exhaustive switch with no default — TypeScript proves totality, which is why
  //    the old engine's unreachable 'Review Lead' fallback is not carried forward.
  switch (stage) {
    case "Qualify Lead":               return "Qualify Lead";
    case "Nurture Lead – Long Term":   return "Nurture Lead";
    case "Activate Lead – Short Term": return "Activate Lead";
    case "Book Appointment":           return "Book Appointment";
    case "Attend Appointment":         return "Confirm / Attend Appointment";
    case "Send Quotation":             return "Send Quotation";
    case "Collect Deposit":            return "Push for Deposit";
    case "Decision Pending":           return "Push for Decision";
  }
}
```

Note what branch 4 preserves: a lead at stage `'Book Appointment'` whose customer asks
"do you have black Venetians?" derives `'Reply Required'` while the **stage stays
`'Book Appointment'`**. The immediate action changes; the commercial objective does not.
That is acceptance test 4.

### Why the engine ignores the interaction log

The `'Awaiting Customer'` rule is phrased as depending on "no customer response
received", which invites reading `lead_interactions`. Don't. `last_outcome` *is* the
record of whether the customer responded; deriving it a second time from the log gives
two sources that can disagree — a customer message logged as a `'Note'` without changing
the outcome, and now the engine and the field say different things.

The invariant is enforced at the **write** seam instead: `logLeadUpdate` with
`direction = 'Inbound'` and `interaction_type = 'Customer Message'` forces
`last_outcome = 'Customer Replied'` unless an outcome was explicitly supplied.

That guard is **unreachable from the Log update form**, where Outcome is the one required
field, so the user always supplies one. It exists for the *next* writer — the WhatsApp /
Telegram ingestion that will insert inbound interactions with no human in the loop. Worth
building now, while the rule is fresh, rather than discovering the hole when the webhook
lands.

The one interaction-derived value the engine needs — `unanswered_followups` — is already
a scalar column on the row. This preserves the discipline documented at
`src/lib/leads/types.ts:74-82` ("The only lead fields the engine reads. Keeps it
trivially testable.").

### `deriveDueStatus(action, nextActionDate, today)`

Effective Action Date is **retired as a concept**. Its only real behaviour was defaulting
the two "ball is with us" actions to today; that is absorbed here:

```ts
if (action === "Closed" || action === "Won") return "Closed";
if (date === null) {
  // The ball is with us and nobody scheduled it. That is due now, not undated.
  return action === "Reply Required" || action === "Send Quotation"
    ? "Due Today"
    : "No Date";
}
if (date < today)  return "Overdue";
if (date === today) return "Due Today";
return "Upcoming";
```

### Remaining derivations

| Function | Rule |
|---|---|
| `deriveBuyingReadiness(stage)` | `'Nurture Lead – Long Term'` → Low; `'Activate Lead – Short Term'` → Medium; `'Book Appointment'` → High; `'Attend Appointment'` and later → High; `'Qualify Lead'` and terminal stages → `null` |
| `deriveDaysToMoveIn(moveInDate, today)` | whole days, negative if past, `null` if no date |
| `deriveQuoteValidUntil(sentAt, validDays)` | `addDays(sentAt, validDays)`, `null` if never sent |
| `deriveCurrentOwner(lead, presalesOwnerId)` | **funnel position** ≥ `'Attend Appointment'` → `assigned_consultant_id ?? owner_id ?? presalesOwnerId`; otherwise `presalesOwnerId ?? owner_id`. Returns a profile id, resolved to a name by the caller. |
| `deriveLead(lead, today, presalesOwnerId)` | orchestrator returning `LeadDerived` |

`quote_valid_until` is **derived, not stored**. Storing it makes a second source of truth
that drifts the instant anyone edits the sent date. `quote_valid_days` is stored
(default 7) so a bespoke quote can carry 14.

**`deriveCurrentOwner` must not use `STAGE_RANK`.** That table is built for queue
ordering and gives `Won`, `Lost` and `Not Qualified` a rank of `0` because they are
unreachable *in the queue* — but ownership is very much reachable at terminal stages. Rank
them 0 and all 41 Won leads fall through to the pre-sales branch and display Jay instead
of the consultant who actually closed them, poisoning conversion-by-consultant analytics,
which is half of why this phase exists.

Ownership therefore reads a **separate ordinal** describing position along the funnel,
where the terminal stages sit at the end rather than at zero:

```ts
const FUNNEL_POSITION: Record<FunnelStage, number> = {
  "Qualify Lead": 0,
  "Nurture Lead – Long Term": 1,
  "Activate Lead – Short Term": 2,
  "Book Appointment": 3,
  "Attend Appointment": 4,     // <- the pre/post-appointment boundary
  "Send Quotation": 5,
  "Collect Deposit": 6,
  "Decision Pending": 7,
  Won: 8,
  Lost: 8,
  "Not Qualified": 0,          // never reached an appointment; stays pre-sales
};
```

`'Not Qualified'` is the one terminal stage that stays at 0: a lead disqualified during
qualification never reached a consultant, so it belongs to pre-sales. `'Lost'` sits at 8
because a lead is normally lost *after* someone worked it — and if it was lost before an
appointment, `assigned_consultant_id` is null and the expression falls through to
`owner_id` anyway.

Two ordinals, two purposes. Do not merge them — and note that **recommendations want a
third rule again**, a blanket terminal-stage guard rather than either ordinal (see below).

### Daily Queue ordering — no priority field

```ts
const DUE_RANK: Record<DueStatus, number> = {
  Overdue: 0, "Due Today": 1, Upcoming: 2, "No Date": 3, Closed: 4,
};

// Commercial advancement. Higher is worked first.
const STAGE_RANK: Record<FunnelStage, number> = {
  "Collect Deposit": 8,
  "Decision Pending": 7,
  "Send Quotation": 6,
  "Attend Appointment": 5,
  "Book Appointment": 4,
  "Activate Lead – Short Term": 3,
  "Qualify Lead": 2,
  "Nurture Lead – Long Term": 1,
  Won: 0, Lost: 0, "Not Qualified": 0,   // unreachable in the queue
};
```

Compare in order: **due rank asc → stage rank desc → `next_action_date` asc** (`null` →
sentinel `'9999-12-31'`) **→ `latest_quote_cents` desc → `name.localeCompare` → `id`**.

Two deliberate choices. Money as a tiebreak is the cheapest way to make "commercially
advanced first" mean something *within* a stage. And the final `id` key is a bug fix:
today's comparator ends at `name` (`queue-engine.ts:282`), so two leads with the same
name leave the order undefined, `Array.prototype.sort` is free to reshuffle them between
renders, and the user loses their place in the queue.

`'No Date'` ranks 3 — open leads with nothing scheduled stay visible as the "you forgot
to schedule this" bucket without outranking overdue work.

### Recommendations, never silent overwrites

`deriveRecommendations(lead, today)` returns
`{ code, message, suggestedStage, clearsOutcome }[]`:

**Every recommendation is gated on a non-terminal stage first.** `deriveRecommendations`
returns `[]` outright when `funnel_stage` is `'Won'`, `'Lost'` or `'Not Qualified'` —
nothing is ever recommended for a closed lead. This guard is its own rule, deliberately
using neither ordinal: `STAGE_RANK` and `FUNNEL_POSITION` both place at least one terminal
stage at 0 (correctly, for their own purposes), so reusing either here would show a
disqualified lead carrying a stale `'Appointment Booked'` outcome a banner urging it back
to `'Attend Appointment'`. Three uses, three rules; the guard is the simplest of them.

With that guard in place:

| code | fires when | suggests | clears outcome |
|---|---|---|---|
| `customer-confirmed` | outcome `'Customer Confirmed'` | `'Won'` | no |
| `customer-declined` | outcome `'Customer Declined'` | `'Lost'` | no |
| `appointment-booked` | outcome `'Appointment Booked'` and funnel position below `'Attend Appointment'` | `'Attend Appointment'` | no |
| `quotation-sent` | outcome `'Quotation Sent'` and stage is `'Send Quotation'` | `'Collect Deposit'` | no |
| `quote-aged` | stage `'Collect Deposit'` and `quoteValidUntil < today` | `'Decision Pending'` | **yes** |
| `move-in-near` | stage is `'Nurture Lead – Long Term'` or `'Activate Lead – Short Term'` and `daysToMoveIn <= 60` | review readiness (no stage applied) | no |

The first two need no stage condition of their own — the terminal guard already means the
stage is not `'Won'`, `'Lost'` or `'Not Qualified'`, so one symmetric rule covers both.

The first two exist because **branch 2 of the cascade otherwise has no exit.** A user who
logs `'Customer Confirmed'` without hand-moving the stage to `'Won'` produces:
`lead_status = 'Active'` (status reads the *stage* only, by design) → passes the `/queue`
SQL filter → `actionRequired = 'Won'` → `dueStatus = 'Closed'`. Without a recommendation
there is no path from a terminal outcome to a terminal stage at all, and the lead sits in
the queue forever. Zero rows hit this at migration; it is the everyday path afterwards.

**`clearsOutcome` is set on `quote-aged` and nothing else.** It is tempting to clear the
outcome on `customer-confirmed` / `customer-declined` too, for symmetry — don't. Once the
stage is `'Won'` or `'Lost'`, branch 1 of the cascade catches the lead before any outcome
branch runs, so nulling `last_outcome` changes no derivation whatsoever. All it does is
erase the record of *what closed the deal* from the very field this phase built to hold
it, and take `'Customer Confirmed'` vs `'Customer Declined'` out of reach of the
closure-reason and win/loss analytics.

`clearsOutcome` matters for exactly one reason, and it is the fix for acceptance test 8.
`'Quotation Sent'` is a branch-4 outcome override, so it returns `'Push for Deposit'` at
`'Send Quotation'`, `'Collect Deposit'` **and** `'Decision Pending'` alike. Accepting
`quote-aged` therefore moves the stage but leaves the action unchanged, and
`'Push for Decision'` is unreachable — unless accepting also sets `last_outcome = null`,
letting the stage branch take over. That is what `clearsOutcome` does, and it follows the
precedent already set by the `'Appointment Completed'` mapping: a null outcome means
"nothing new from the customer; the stage decides."

**`quotation-sent` is deliberately inert for Action Required.** It moves stage rank
(queue ordering), starts the aging clock and feeds quote→deposit analytics, but the
action is `'Push for Deposit'` before and after. Recorded here explicitly so it is a
decision rather than a surprise — this is the same "moves the chip on screen and nothing
else" trap the codebase already documents at `appointments.ts:174-177`.

Rendered as a banner. A recommendation carrying a `suggestedStage` gets an **Accept**
button that applies the stage and writes a `lead_stage_events` row; **`move-in-near` is
dismiss-only**, because it suggests reviewing readiness rather than a specific stage — an
Accept button there would have nothing to apply and would write a null-to-null stage
event. `acceptRecommendation` rejects a code with no `suggestedStage` rather than
no-op'ing, so the two can't drift. Dismissals persist in `leads.dismissed_recommendations text[]`,
cleared by the server action whenever any input to a recommendation changes:
`funnel_stage`, `last_outcome`, `quotation_sent_at`, `quote_valid_days` **and
`move_in_date`**. The last one is easy to forget and produces a stuck banner: dismiss
`move-in-near`, then edit the move-in date to something imminent, and the warning stays
suppressed on exactly the lead that now needs it. A banner that reappears after being dismissed teaches the
user to ignore banners within a week, which would destroy the entire
recommend-don't-overwrite premise.

**Funnel Stage is never written behind the user's back** *by the running app*, with
exactly one sanctioned exception: `bookAppointment` sets `'Attend Appointment'`, because
the user has just filled in a date, time and consultant — the intent is unambiguous.
(`setAppointmentStatus` also moves it, but only as the completion or undo of that same
explicit act.) The one-off migration forces two fields under its own rules; see
"Stage-agreement rules", which explains why that is a different situation and not an
exception to this. That write records a
`lead_stage_events` row with `source = 'system'` so stage-duration analytics don't
attribute an automatic move to a human.

---

## Data model

Five migrations, one logical change each per `rules/data/migrations.md`.

> `data/migrate.ts` runs all pending migrations **inside one transaction**. Postgres
> forbids using a value added by `ALTER TYPE … ADD VALUE` in the same transaction, so
> extending the existing enums is not available even before the house rule against
> `alter type … drop value` makes it a bad idea. New types must be created fresh.

### `down()` — what reverses and what does not

`rules/data/migrations.md` requires a `down()` on every migration, and requires that an
irreversible step be **left in place with a comment explaining why**, never silently
skipped. Per file:

| migration | `down()` |
|---|---|
| 1 — enums | Fully reversible. Drop the nine new types, rename the four `*_legacy` types back. Must run *after* migration 3's `down()` has restored the columns to those types, which the migrator's reverse order guarantees. |
| 2 — sidecar | Fully reversible: `drop table lead_legacy_import`. |
| 3 — columns | **Mostly reversible, and only because of the sidecar.** Reverse the renames, drop the added columns, and restore `funnel_stage` / `last_outcome` / `lead_status` / `contact_channel` / `inbound_outbound` from `lead_legacy_import` rather than from an inverse `CASE` — the forward mapping is lossy (14 outcomes → 9), so an inverse `CASE` cannot exist. Recreate `leads_lead_status_idx`. **Irreversible:** the three free-text columns can be restored from the sidecar, but any edit made to the new columns *after* the migration is lost on rollback. Comment it. |
| 4 — interactions | Reversible: drop both tables and the trigger. The seeded `'Note'` rows die with the table; the text survives in the sidecar. |
| 5 — status trigger | Reversible: drop the trigger, the index and the column. Note in a comment that the `set not null` cannot be reinstated by a re-run of `up()` if rows have since been inserted with a null status — they cannot, because the trigger assigns unconditionally, which is worth saying out loud. |

The honest summary: **rollback is safe up to the point where the app starts writing.**
Once a consultant has logged an interaction or moved a lead through the new vocabulary,
`down()` restores the schema but not that work. Take a database snapshot before running
migration 1.

And note the mechanics: `npm run db:migrate:down` reverts **one** migration per
invocation, so a full rollback of this phase is **five** runs. The reverse-order guarantee
above (migration 1's `down()` requiring migration 3's to have run first) only holds if all
five are run, in order, to completion. Stopping after two leaves the database in a state
no `up()` or `down()` describes.

### 1. `202608281000_lead_enums.ts` — types only, no table touched

```sql
alter type public.lead_funnel_stage rename to lead_funnel_stage_legacy;
alter type public.lead_status       rename to lead_status_legacy;
alter type public.lead_outcome      rename to lead_outcome_legacy;
alter type public.lead_source       rename to lead_source_legacy;
-- then create the nine new types listed above
```

Renaming the old types rather than suffixing the new ones `_v2` is what keeps
`kysely-codegen` emitting a clean `LeadFunnelStage` on the hot `Leads` interface instead
of `LeadFunnelStageV2` forever. Catalog-only, instant, no table rewrite — existing
columns follow their type by OID and are simply `*_legacy`-typed until Migration 3.

*Verify:* `npm run db:codegen && npx tsc --noEmit` now fails at every hardcoded legacy
label. **That error list is the work queue for the application steps.**

### 2. `202608281100_lead_legacy_snapshot.ts` — the sidecar

`lead_legacy_import`: `lead_id` PK → `leads`, plus `funnel_stage
lead_funnel_stage_legacy`, `lead_status lead_status_legacy`, `last_outcome
lead_outcome_legacy`, `action_detail_override text`, `action_date date`,
`buying_readiness text`, `keys_status text`, `expected_key_date text`, `owner_id uuid`,
**`first_initiated_at`, `last_contact_at` and `last_customer_response_at` (all
`timestamptz`)**, `snapshot_at timestamptz`. Populated from the current `leads` values
**before anything is rewritten**.

The three timestamps are snapshotted even though Migration 3 does not touch them, because
Migration 4's interaction backfill hands them to a trigger that then recomputes them.
Without a pre-image there is nothing to verify the round trip against, and a silent
regression there wipes exactly the columns this phase set out to unfreeze.

**Why a sidecar and not `legacy_*` columns.** `lead-fields-form.tsx:84-87` already
documents the trap: `updateLead` writes the whole row, so a field the form omits is set
to `NULL` rather than left alone — 238 leads carry `buying_readiness` and 205 carry
`keys_status`, and without a round-trip the first save on any lead silently destroys
them. Six `legacy_*` columns would be six more instances of that footgun, six more legacy
enum types glued to the codegen output, and six more fields dragged along by the
`selectAll()` at `[leadId]/page.tsx:37`. Nothing can corrupt a sidecar because no write
path to it exists. JSONB is worse still: it defeats the house preference for real enums
and you lose the ability to `GROUP BY old_value, new_value` to audit the mapping.

*Verify:* `select count(*) from lead_legacy_import` = 244.

### 3. `202608281200_lead_new_columns.ts` — conversions and new fields

**The step order below is load-bearing.** `source` must be renamed to `contact_channel`
*before* a new `source` column is added, or the `add column` collides with the existing
name. Write the migration in exactly this sequence.

**Step 1 — rename, so the names are free.**

| old | new |
|---|---|
| `leads.source` | `leads.contact_channel` |
| `leads.initiator` | `leads.inbound_outbound` |
| `leads.action_date` | `leads.next_action_date` |
| `leads.action_detail_override` | `leads.action_detail` |

**Step 2 — drop the legacy `lead_status` column.**

`leads.lead_status` **already exists** — `NOT NULL default 'Active'`, created at
`202608221000_leads.ts:84-86` and indexed at `:131`. Migration 1 renamed its *type* to
`lead_status_legacy`, but the column itself survives. It must be dropped here, along with
`leads_lead_status_idx`, or Migration 5's `add column lead_status` and its index both
collide. Migration 2 has already snapshotted every legacy value, so nothing is lost.

```sql
drop index if exists public.leads_lead_status_idx;
alter table public.leads drop column lead_status;
```

**Step 3 — convert types in place** (via `USING (case … end)`, mapping tables below):

- `leads.funnel_stage` → `lead_funnel_stage`, `NOT NULL`, default `'Qualify Lead'`
- `leads.last_outcome` → `lead_outcome`, nullable
- `leads.contact_channel` → `lead_contact_channel` (`telegram`→`'Telegram'`,
  `whatsapp`→`'WhatsApp'`, `manual`→`'Other'`)
- `leads.inbound_outbound` → `lead_direction` (`'Customer'`→`'Inbound'`,
  `'Us'`→`'Outbound'`)
- **`appointments.lead_stage_before` and `appointments.lead_outcome_before` — the same
  `CASE`s as `leads`.** These are live restore machinery (`appointments.ts:193-202` writes
  them straight back into `leads` on cancel), not history. Leaving them legacy-typed means
  the first cancellation after cutover writes an invalid enum value into `leads`.

**Step 4 — add the new columns.**

`source lead_source` (nullable, backfilled from the `lead_ref` prefix),
`unanswered_followups int NOT NULL default 0`, `last_message_by lead_direction`,
`keys_collected boolean` (**nullable**), `move_in_date date`,
`primary_product lead_primary_product`, `assigned_consultant_id uuid → profiles`,
`quotation_breakdown text`, `quotation_sent_at timestamptz`,
`quote_valid_days int NOT NULL default 7`, `closure_reason lead_closure_reason`,
`dismissed_recommendations text[] NOT NULL default '{}'`.

`last_message_by` is `lead_direction` (`'Inbound'`/`'Outbound'`), **not** the old
`lead_initiator` (`'Customer'`/`'Us'`). One vocabulary for direction across the whole
module; the trigger derives this column from `lead_interactions.direction`, so having the
two disagree on wording would mean translating at every read. Render it as
"Customer" / "Us" in the UI if that reads better.

**Step 5 — drop what is now unused.**

From `leads` (preserved in the sidecar and as a timeline note): `buying_readiness`,
`keys_status`, `expected_key_date`. Then `drop type public.lead_initiator` — nothing
references it once `initiator` has been converted.

**Step 6 — `profiles.is_presales_owner boolean NOT NULL default false`**, set true for Jay.

`keys_collected` is nullable rather than `NOT NULL default false` because 39 leads have
no `keys_status` at all and "unknown" is a real third state — defaulting to `false`
asserts something we don't know.

*Verify* against these two distributions — **not** against the raw mapping tables. The
three stage-agreement forces mean the post-migration counts deliberately differ from a
straight column-by-column rename, so "ditto the mapping table" would be a gate that fails
by construction. Computed over the 244 fixture rows:

```sql
select funnel_stage, count(*) from leads group by 1 order by 2 desc;
```

| `funnel_stage` | rows | | `last_outcome` | rows |
|---|---|---|---|---|
| `'Not Qualified'` | 106 | | `'No Response'` | 130 |
| `'Lost'` | 54 | | `'Customer Confirmed'` | 33 |
| `'Won'` | 41 | | `'Customer Declined'` | 25 |
| `'Activate Lead – Short Term'` | 15 | | `'Quotation Sent'` | **22** |
| `'Nurture Lead – Long Term'` | 11 | | `NULL` | **14** |
| `'Qualify Lead'` | **8** | | `'Appointment Booked'` | 8 |
| `'Collect Deposit'` | 3 | | `'Awaiting Customer'` | 7 |
| `'Decision Pending'` | 3 | | `'Customer Replied'` | 5 |
| `'Attend Appointment'` | **3** | | both barriers | 0 |
| `'Send Quotation'`, `'Book Appointment'` | 0 | | | |
| **total** | **244** | | **total** | **244** |

The bolded cells are where the forces bite. `'Quotation Sent'` is 22, not the 29 in the
mapping table, because 7 were nulled. `NULL` is 14 — the 7 `'Appointment Completed'` rows
plus those 7. `'Qualify Lead'` is 8 and `'Attend Appointment'` 3 because index 242 moved.

Also verify `select count(*) from appointments where lead_stage_before is not null` is
unchanged, and that `leads` has no `lead_status` column at this point.

### 4. `202608281300_lead_interactions.ts` — the log

`lead_interactions`: `id` uuid PK, `lead_id` → `leads` (RESTRICT), `occurred_at
timestamptz NOT NULL`, `direction interaction_direction` **nullable**, `interaction_type
interaction_type NOT NULL`, `note text`, `channel lead_contact_channel`, `created_by`
→ `profiles`, `created_at`. Indexed on `(lead_id, occurred_at desc)`.

`direction` is nullable because a `'Note'` has no direction; forcing `'Outbound'` onto
migration notes would pollute the counter's input space.

`lead_stage_events`: `id` uuid PK, `lead_id` → `leads` (RESTRICT),
`from_stage lead_funnel_stage` **nullable** (null on a lead's first event, and on the
migration backfill where the prior stage is unknowable), `to_stage lead_funnel_stage NOT
NULL`, `changed_at timestamptz NOT NULL`, `changed_by uuid → profiles` nullable, `source text NOT NULL` (`'user'` | `'system'`).
**`changed_by` is recorded even when `source = 'system'`** — the only system write is
`bookAppointment`, which has the session user in hand, and stage-duration-by-consultant
will want it. `source` distinguishes "the app moved this" from "a human chose it"; it is
not a licence to drop the actor. `changed_by` is null only on the migration backfill.

**Migration 4 backfills one row per lead**: `from_stage` null, `to_stage` = the migrated
stage, `changed_at` = `last_contact_at ?? first_initiated_at ?? now()`, `changed_by` null,
`source = 'system'`. Without it the table starts empty and every migrated lead looks like
it has been at its current stage since the day of cutover, which quietly makes the first
few months of stage-duration analytics meaningless. The backfilled row is an origin
marker, not a claim about history — that is what the null `from_stage` says. Indexed on
`(lead_id, changed_at)`. This is what makes "average days between stages" and lead aging
answerable.

**Trigger `lead_interactions_refresh_lead`** — `AFTER INSERT OR UPDATE OR DELETE`,
maintains on `leads`:

- `unanswered_followups` = count of rows with `direction = 'Outbound'` and
  `interaction_type = 'Follow-Up'` occurring **after** the latest `'Inbound'` row (or all
  of them, if the customer has never replied). An ordinary `'Reply'` never increments it,
  so "here's the catalogue / here's another colour / here's a photo" counts as **zero**
  failed attempts, not three.
- `last_message_by` = the `direction` of the latest directed row, copied verbatim
  (`'Inbound'` / `'Outbound'`) — same vocabulary, no translation. The UI may render it as
  "Customer" / "Us".
- `last_contact_at` = latest directed row's `occurred_at`
- `last_customer_response_at` = latest `'Inbound'` row's `occurred_at`

**A trigger, not the server action.** Any other writer — a SQL fix, a re-import, the
future Telegram webhook — desyncs a counter maintained in application code, and that
counter feeds `lead_status`, which gates queue visibility, so drift silently *hides*
leads.

This also fixes a **live bug**: `last_customer_response_at`, `last_contact_at` and
`first_initiated_at` are written **only** by `scripts/import-leads.ts:208-210`. No server
action touches them. They have been frozen since the import, so the current engine's
90-day staleness exclusion is permanent for every lead whose imported last-response
predates the cutoff — no matter how much they are actually contacted.

#### Backfill: seed the trigger's **inputs**, never its outputs

This is the subtlest part of the phase and the easiest to get catastrophically wrong.

**The trap.** The obvious design seeds `unanswered_followups` as a scalar in Migration 3
(2 for the 117 legacy-`Unresponsive` leads, 1 for 11 more) and then, in Migration 4,
inserts one free-text `'Note'` per lead. That `'Note'` insert **fires the trigger 244
times**, and the trigger recomputes from `lead_interactions` — which at that moment
contains nothing but an undirected `'Note'`. Outbound `'Follow-Up'` rows: zero.

The seed is destroyed by the migration shipping beside it. Three consequences, all from
that one insert:

1. `unanswered_followups` becomes **0 on all 244**. `Unresponsive` ceases to exist as a
   state anywhere in the database, including the 3 ghosting `'Collect Deposit'` leads
   assumption 7 names by hand.
2. `last_contact_at`, `last_customer_response_at` and `last_message_by` are overwritten
   with **NULL** — the trigger reads "the latest directed row", and there isn't one. That
   contradicts migration assumption 5 outright and wipes the very columns this migration
   exists to unfreeze.
3. The stage-event backfill reads `last_contact_at`, which the interaction backfill just
   nulled, so `changed_at` collapses to `now()` for all 244.

Neither safety net catches it. The fixture pin is insensitive — the queue count stays 43
because the 4 non-terminal `Unresponsive` leads merely relabel to `Active`, the same way
that pin was insensitive to the cascade bug. And `verify-derivations.ts` asserts
`unanswered_followups` equals a fresh recount from `lead_interactions`, which is 0 — **the
recount agrees with the bug.** That check is circular by construction; see below.

**The fix.** The counter is trigger-owned, per this spec's own rule that no action writes
it. A seeded scalar was always going to lose to the trigger. Seed the *inputs* instead, in
this order:

| # | rows | `occurred_at` | type / direction |
|---|---|---|---|
| 1 | one per lead **with** a `last_customer_response_at` — **196 of 244** | the imported `last_customer_response_at` | `'Customer Message'` / `Inbound` |
| 2 | 2 per legacy-`Unresponsive` lead (**117**), 1 per `'Follow-Up Sent'`-and-not-Unresponsive lead (**11**) | at `last_contact_at`, spaced 1 second apart ascending, floored to `last_customer_response_at + 1s` so they are strictly after the inbound | `'Follow-Up'` / `Outbound` |
| 3 | one per lead where `last_contact_at > last_customer_response_at` and no row of type 2 was written | the imported `last_contact_at` | `'Reply'` / `Outbound` |
| 4 | one per lead, as before | `snapshot_at` | `'Note'` / **null direction** |

Row type 3 is what keeps `last_contact_at` honest for leads that were never chased: without
it the trigger would recompute their last contact down to their last *reply*. `'Reply'` is
the right type because it does not increment the counter — we know we contacted them, we
don't know it was a follow-up, and `'Reply'` is the non-counting default.

Now the trigger's recompute **reproduces** 2 / 1 / 0 instead of erasing it, and
`last_contact_at`, `last_customer_response_at` and `last_message_by` land on their imported
values *by construction* rather than by assumption. R10's self-healing claim becomes true
rather than aspirational.

Coverage checks out: 74 of the 117 `Unresponsive` leads and all 11 `'Follow-Up Sent'` leads
have a response date to anchor to. The 48 leads with no response date at all fall into the
trigger's "or all of them, if the customer has never replied" branch, which gives the same
answer without an anchor.

**Ordering inside Migration 4 is load-bearing:** create the tables → seed interactions →
seed stage events. The stage-event backfill reads `last_contact_at`, which only exists
once the interaction seed has fired the trigger.

**The synthetic rows are visible in the timeline**, and should be — the `'Note'` backfill
already sets that precedent. Give the type-2 rows a note reading
`Migrated — the spreadsheet recorded this lead as unresponsive`, so a consultant reading
the timeline sees reconstruction rather than a phantom conversation.

**Known imprecision, bounded:** for a lead whose imported `last_contact_at` is not strictly
after its `last_customer_response_at`, the 1-second floor moves the recomputed
`last_contact_at` forward by one or two seconds. Sub-minute drift on a migrated timestamp
changes no derivation — every rule compares Singapore *calendar dates* — but it is a real
deviation and is why the verification below allows it.

*Verify:*
- `select unanswered_followups, count(*) from leads group by 1` → **2: 117, 1: 11, 0: 116**
- `last_contact_at`, `last_customer_response_at` and `first_initiated_at` match
  `lead_legacy_import` for all 244, to within 2 seconds
- delete a seeded interaction inside a rolled-back transaction and confirm the counter moves

### 5. `202608281400_lead_status_trigger.ts`

Adds the `lead_status` column (new type), a `BEFORE INSERT OR UPDATE` trigger
`leads_derive_status` that assigns it unconditionally, a one-shot update to fire it, then
`set not null` and `leads_lead_status_idx`. Trigger firing order is alphabetical, so
`leads_derive_status` runs before the existing `leads_set_updated_at`; both are
`BEFORE … FOR EACH ROW` returning `NEW` and compose cleanly.

Both the column name and the index name are free **only because Migration 3 step 2
dropped the originals.** If that step is skipped, this migration fails twice over.

**Why stored rather than derived at read time.** The house rule is *derive at read time
anything that depends on today*. `lead_status`'s inputs — `funnel_stage` and
`unanswered_followups` — are both stored and neither is today-dependent, so it does not
rot overnight. It is therefore exactly the class of derived value that **should** be
materialised. `due_status` and `action_required` are not, and stay in TypeScript.

Two concrete arguments. The queue needs it **in SQL**: `leads/page.tsx:65` currently
selects every non-archived lead and filters in Node, and a stored status cuts that from
244 rows to 43 — the ones actually workable. And a `BEFORE` trigger that assigns
unconditionally means any app write to the column is discarded, making `Won + Active`
*impossible* rather than merely unlikely. 5 of the 13 analytics questions also group by it.

This is **not** a pagination argument. Queue ordering keys on `dueStatus`,
`actionRequired` and `STAGE_RANK`, all derived in TypeScript, so `/queue` still fetches
its whole filtered set and sorts in Node. Cutting the set to a sixth is the win on its own.

Not a `GENERATED ALWAYS AS … STORED` column: enum I/O functions are marked `STABLE`, so
Postgres rejects the generation expression as non-immutable.

**The cost, stated plainly.** The rule now exists twice — once in PL/pgSQL, once as
`deriveLeadStatus` in TypeScript (needed for the banners and optimistic UI). They can
drift. `scripts/verify-derivations.ts` reconciles them. There is no DB test harness in
this repo (`vitest.config.ts` is `environment: "node"`, zero DB tests), so a script run
before deploy is the proportionate answer rather than testcontainers.

*Verify:* `select count(*) from leads where funnel_stage in ('Won','Lost','Not Qualified')
and lead_status <> 'Closed – Won' and lead_status <> 'Closed – Lost' and lead_status <>
'Closed – Not Qualified'` returns **0**. Before this phase the same query over the legacy
column returns **141** (26 `Active`, 113 `Unresponsive`, 2 `Nurture`) — that is the
headline inconsistency, gone.

---

## Migration mapping

Both tables live in `src/lib/leads/migration-map.ts` so the migration and the fixture test
share one definition. **The outcome map is not a plain `Record<OldOutcome, NewOutcome>`** —
three of its rows depend on the lead's stage, and typing it as a flat rename means anyone
implementing from this file alone silently drops all three rules:

```ts
type OutcomeRule =
  | NewOutcome | null
  | ((stage: FunnelStage) => NewOutcome | null);

export const OUTCOME_MAP: Record<OldOutcome, OutcomeRule> = { … };

// Stage forces are a separate, ordered pass — they rewrite the stage, not the outcome.
export const STAGE_MAP: Record<OldStage, NewStage> = { … };
export function forceStage(stage: NewStage, outcome: NewOutcome | null,
                           legacyOutcome: OldOutcome): NewStage { … }
```

The stage-dependent rows are `'Quote Sent'` (nulled outside `'Collect Deposit'`),
`'Barrier / Objection Raised'` (splits pre/post-appointment) and `'Renovation Delayed'`
(also forces stage and date). `'Appointment Booked'` drives a stage force rather than an
outcome rule, so it lives in `forceStage`.

The totality test must therefore **exercise every function entry across all 10 legacy
stages**, not merely assert that all 14 keys are present. A `Record` with every key filled
in still passes a naive totality check while returning the wrong value for 9 stages out
of 10.

Ordering within the migration is fixed and must match `migration-map.ts`: map the stage,
then map the outcome, then apply the stage forces (which read the mapped outcome), then
apply the date forces.

**That order is only safe because the two passes happen not to overlap, and that is luck
rather than design.** The dependency is mutual: the outcome rules read the mapped *stage*
(`'Quote Sent'` nulls outside `'Collect Deposit'`) while the stage forces read the mapped
*outcome* (`'Appointment Booked'` → `'Attend Appointment'`). Running the outcome pass
first means it reads a stage a later force may change.

No legacy value participates in both passes today — `'Quote Sent'` triggers an outcome
rule and no stage force; `'Appointment Booked'` and `'Appointment Confirmed'` trigger a
stage force and no outcome rule — so no row is affected by the order. **The third rule
someone adds will not be so lucky.**

The cheap guard is an idempotence assertion in the map's test: run the full force pass
twice over all 244 fixture rows and assert the second run changes nothing. A rule that
reads an input a later pass rewrites fails it immediately, and it costs four lines.

### `funnel_stage` — 10 → 11

| old | rows | new | note |
|---|---|---|---|
| `'New Lead'` | 9 | `'Qualify Lead'` | clean |
| `'Not Qualified'` | 106 | `'Not Qualified'` | identity |
| `'Qualified / Pre-Appointment'` | 15 | `'Activate Lead – Short Term'` | **decision** — see above |
| `'Appointment Booked'` | 2 | `'Attend Appointment'` | clean |
| `'Post-Appointment / Quote Pending'` | 0 | `'Send Quotation'` | clean, zero rows |
| `'Quote Sent'` | 3 | `'Collect Deposit'` | **name trap** — `'Send Quotation'` means the quote is *owed*; mapping on name similarity would tell the user to re-quote 3 customers who already have one |
| `'Decision Pending'` | 3 | `'Decision Pending'` | identity |
| `'Nurture'` | 11 | `'Nurture Lead – Long Term'` | see below |
| `'Won'` | 41 | `'Won'` | identity |
| `'Lost'` | 54 | `'Lost'` | identity |

All 11 `'Nurture'` rows go **Long Term**. Do not fuzzy-parse `buying_readiness`
(`'Mid-Sep'`, `'Early Jan 2027'`, `'ASAP'`) to split them: `'Activate Lead – Short Term'`
is the *urgent* bucket, a wrong promotion puts phantom urgency in the day-one queue, and
under-promoting is a ten-minute manual pass over 11 rows. Asymmetric cost.

### `last_outcome` — 14 → 9

| old | rows | new | note |
|---|---|---|---|
| `'Customer Replied'` | 2 | `'Customer Replied'` | identity |
| `'No Response'` | 67 | `'No Response'` | identity |
| `'Appointment Booked'` | 2 | `'Appointment Booked'` | identity |
| `'Customer Declined'` | 25 | `'Customer Declined'` | identity |
| `'Quote Sent'` | 29 | `'Quotation Sent'`, **conditionally nulled** | rename, but see the stage-agreement rule below — 19 land at a terminal stage and are unaffected, 3 keep the outcome, 7 have it nulled |
| `'Order Confirmed'` | 33 | `'Customer Confirmed'` | rename |
| `'Ready to Book Appointment'` | 3 | `'Customer Replied'` | **lossy** — warmth now lives in the stage, not the outcome |
| `'Appointment Confirmed'` | 6 | `'Appointment Booked'` | lossy but operationally free — both derive `'Confirm / Attend Appointment'` |
| `'Appointment Completed'` | 7 | **`null`** | **deliberate.** The new vocabulary is strictly *what the customer did*; "we finished the appointment" is not that. The fact lives in `appointments.status = 'completed'` and in stage `'Send Quotation'`. A `null` outcome matches no outcome branch, so the stage decides. Inventing a 10th outcome to hold it would reintroduce the overlap this phase removes. **None of these 7 rows actually reach the stage switch:** all sit at a terminal legacy stage (6 `'Lost'`, 1 `'Won'`) and are caught by branch 1. The `'Send Quotation'` path is for appointments completed *after* cutover. |
| `'Follow-Up Sent'` | 63 | `'No Response'` | **the biggest lossy mapping — 26% of the database.** `'Follow-Up Sent'` describes *our* action; the new enum describes the customer's. An unanswered outbound is `'No Response'`. Mapping to `'Awaiting Customer'` instead would silently drop 63 leads out of the queue on day one. |
| `'Customer Needs Time'` | 4 | `'Awaiting Customer'` | **judgement + booby trap.** `'Awaiting Customer'` is date-gated, so these 4 rows **must also get `next_action_date = current_date + 30`** in the same migration, or they surface as `'Follow-Up'` the morning after cutover — the exact opposite of "needs time". |
| `'Renovation Delayed'` | 3 | `'Awaiting Customer'` | **lossy** — the reason is real information and is now a nurture signal, not an outcome. Also forces stage → `'Nurture Lead – Long Term'` and `next_action_date = current_date + 60`, and preserves the reason as a `'Note'` interaction. |
| `'Barrier / Objection Raised'` | 0 | split by stage | stages before `'Send Quotation'` → `'Pre-Appointment Barrier'`, `'Send Quotation'` onward → `'Post-Appointment Barrier'`. Zero rows; write the `CASE` anyway. |
| `'Quote Requested'` | 0 | `'Customer Replied'` | zero rows |

Both tables sum to exactly **244**. Every imported lead carries an outcome — there are no
nulls in the source data — so the `CASE` needs no null branch for the migration itself,
though `last_outcome` remains nullable because the new model writes nulls (`'Appointment
Completed'`, and `clearsOutcome` recommendations).

### Stage-agreement rules

Two outcomes would otherwise leave a migrated lead whose own fields contradict each other.
Both are handled the same way the `'Renovation Delayed'` row already is — the migration
forces the field that is wrong rather than carrying the contradiction forward.

**This does not contradict "Funnel Stage is never written behind the user's back."** That
rule governs the *running app*: a consultant's deliberate choice must not be silently
overwritten while they work. A one-off migration is a different thing — it is the moment
the vocabulary changes underneath every row, nobody has yet made a choice in the new
vocabulary, and `lead_legacy_import` preserves every original value verbatim. The rule
resumes the moment the app starts writing.

**But note the asymmetry — only one of these forces is compelled.** The `'Quotation Sent'`
nulling is *necessary*: assumption 7 means `quotation_sent_at` is null on every migrated
lead, so `quote-aged` can never fire, so no runtime path could ever resolve those 7 —
leaving them alone means leaving them broken forever. The `'Appointment Booked'` force is
a *choice*: the `appointment-booked` recommendation would resolve that single row in one
click, which is the mechanism this spec prefers everywhere else. It is forced anyway
because one row is not worth a banner, and because the stage table already makes the same
judgement in the other column — but that is a preference, not a necessity, and it is the
first thing to revisit if the rule ever misfires.

#### `'Appointment Booked'` forces the stage

One row does this: fixture index 242, legacy `'New Lead'` + `'Appointment Booked'`, which
would map to stage `'Qualify Lead'` with outcome `'Appointment Booked'` and derive
`Confirm / Attend Appointment`, Overdue. A lead told to attend an appointment while its
stage says "qualify this lead".

**Rule:** any lead whose mapped outcome is `'Appointment Booked'`, whose stage is
non-terminal, and whose funnel position is below `'Attend Appointment'`, is forced to
`'Attend Appointment'`. The stage table already maps legacy `'Appointment Booked'` →
`'Attend Appointment'`; this extends the same judgement to the outcome column, where the
legacy stage disagreed with it.

Terminal stages are excluded — a `'Lost'` lead carrying a stale `'Appointment Booked'`
outcome stays `'Lost'`.

Effect on the counts: `'Qualify Lead'` 9 → **8**, `'Attend Appointment'` 2 → **3**.

#### `'Quotation Sent'` forces the outcome

`'Quotation Sent'` is a branch-4 override, so it returns `'Push for Deposit'` at *every*
non-terminal stage. Of the 29 leads carrying it, 19 land at a terminal stage and are
caught by branch 1. The other **10** are split 3 / 3 / 4, and two of those groups produce
a lead whose own fields contradict each other:

| new stage | rows | derived action | verdict |
|---|---|---|---|
| `'Collect Deposit'` | 3 | `Push for Deposit` | **agrees — keep the outcome** |
| `'Decision Pending'` | 3 | `Push for Deposit` | contradicts: the stage says the deposit window has passed. **Null the outcome** → `Push for Decision` |
| `'Nurture Lead – Long Term'` | 4 | `Push for Deposit` | renders as *Nurture Lead – Long Term · Push for Deposit · Readiness Low* — three fields disagreeing on one queue row. **Null the outcome** → `Nurture Lead` |

So the migration nulls `last_outcome` for the 7 leads whose stage sits outside
`'Collect Deposit'`. This is not a new mechanism: it is exactly what `clearsOutcome` on
`quote-aged` does at runtime, applied at migration time to leads whose quote already aged
before the app could observe it — and it follows the precedent already set for
`'Renovation Delayed'`, where the migration also forces stage and date rather than
carrying a contradiction forward.

Nothing is lost: `latest_quote_cents` still holds the figure, and the value is what the
pipeline total and the analytics read.

Without this rule the 3 at `'Decision Pending'` are permanently frozen in acceptance test
8's "before accepting" state — `quotation_sent_at` is null (assumption 7), so `quote-aged`
can never fire, so `clearsOutcome` never runs, so `'Push for Decision'` is unreachable on
real rows forever.

### `unanswered_followups` — seeded as interactions, not as a number

The intended end state is unchanged:

| condition | `unanswered_followups` | rows |
|---|---|---|
| legacy `lead_status = 'Unresponsive'` | **2** — that column is the only field that literally encodes "they stopped answering", and 2 is the threshold, so this reproduces the state exactly | 117 |
| legacy `last_outcome = 'Follow-Up Sent'` and not Unresponsive | **1** — one outbound went unanswered but nobody declared the lead dead | 11 |
| everything else | **0** | 116 |

**But the column is never written directly.** It is trigger-owned, so Migration 3 adds it
with its `default 0` and leaves it alone; Migration 4 reaches these numbers by inserting
the `'Follow-Up'` interactions that produce them. Writing the scalar and then inserting any
interaction destroys it — see "seed the trigger's inputs" under Migration 4, which is where
this actually happens.

Downstream, exactly **4** leads end up at `lead_status = 'Unresponsive'`: of the 117
legacy-Unresponsive rows, 113 sit at a terminal stage and derive `Closed – *` instead.

### Free-text fields

`keys_collected` from `keys_status`:
`true` on `^(yes|y|collected|keys collected|done|got keys?)$`,
`false` on `^(no|n|not collected|pending|not yet)$`, otherwise **`NULL`**.

`move_in_date` from `expected_key_date`: **only** strict `YYYY-MM-DD` or `D/M/YYYY`.
Everything else `NULL`. No month-name parsing, no relative terms.

The original migration already made this call
(`202608221000_leads.ts:104-105` — "Coercing either column to a date would invent data"),
and the stakes are now *higher*, not lower: `days_to_move_in` feeds derived Buying
Readiness and the `move-in-near` warning across 238 rows. A wrong date manufactures a
wrong urgency signal at scale; a null manufactures nothing.

The gap is given a finite shape rather than left as a permanent unknown:
`/leads?needs_review=1` filters `move_in_date is null and legacy.buying_readiness is not
null` with an inline "set move-in date" control, turning 238 rows into a burn-down list.

---

## Screens

### `/queue` — Daily Queue (new, first in nav)

The primary working surface. `lead_status in ('Active','Unresponsive')` and
`is_archived = false` pushed into **SQL**; only `dueStatus`, `actionRequired` and
`daysToMoveIn` derive in TypeScript.

Columns, per the requirement: **Due Status · Action Required · Customer · Funnel Stage ·
Action Detail · Next Action Date · Move-In / Days · Latest Quotation · Last Contact ·
Current Owner.** Mine/All owner toggle.

**Every derived `DueStatus` has a group. All five.** The queue filters on `lead_status`
in SQL, so a lead whose *outcome* is terminal but whose *stage* is not passes the filter
and derives `dueStatus = 'Closed'` — and with only Overdue/Due Today/Upcoming groups it
would sit in the queue rendering nowhere at all.

| group | holds | placement |
|---|---|---|
| **Needs closing** | `dueStatus = 'Closed'` | **pinned at the top**, with the `customer-confirmed` / `customer-declined` Accept button inline |
| Overdue | `'Overdue'` | |
| Due Today | `'Due Today'` | |
| Upcoming | `'Upcoming'` | |
| Unscheduled | `'No Date'` | collapsed by default |

The Needs-closing group is normally empty and is a one-click resolution when it isn't:
the user logged the win, and this is the app asking them to confirm the stage rather than
moving it behind their back.

An `Unresponsive` lead appears **only** when its `next_action_date` is due — it is hidden
from immediate action, not excluded from the system. Unresponsive ≠ Lost.

**Needs closing bypasses that gate.** A lead can be `Unresponsive` (two unanswered
follow-ups) *and* carry a terminal outcome — the customer went quiet, then finally
confirmed. Applying the date gate would hide the very row R8 depends on, and the lead
would sit un-closable until its `next_action_date` came round. Rows with
`dueStatus = 'Closed'` are always shown.

Header stats: leads in queue · due today · overdue · pipeline value.

### `/leads` — the database

Search (name, mobile, development, `lead_ref`) **plus filters** on funnel stage, lead
status, owner, contact channel, lead source, primary product, and `needs_review`. Phase
15 specced these filters and shipped search only; this closes that gap.

Columns: Customer · Funnel Stage · Lead Status · Last Outcome · Owner · Channel · Source ·
Next Action Date · Quote.

### `/leads/[leadId]` — lead detail

1. Header: name, `lead_ref`, development, mobile
2. Derived strip: **Lead Status · Action Required · Due · Buying Readiness · Current
   Owner · Unanswered follow-ups**
3. Recommendation banners (Accept / Dismiss)
4. **Log update form** — the daily driver, described below
5. Appointment card — Phase 15's card and sync banners are unchanged; the **booking
   dialog gains a required consultant select** (see `bookAppointment` below)
6. Interaction timeline
7. Interaction summary — **read-only here.** It is edited in the Log update form (4),
   which owns the field; see below
8. Read-only details block with an **Edit details** link
9. History (`historical_summary`) if present

**The remount key is narrowed, not deleted.** The problem
(`[leadId]/page.tsx:143-176`) is real and does not go away: the detail page still has four
surfaces that mutate the same lead row — recommendation Accept/Dismiss (3), the Log update
form (4), the appointment card's book/reschedule/status buttons (5) and the
`/leads/[leadId]/edit` round trip. The Log update form is a client form whose Funnel Stage select is pre-filled
from `lead.funnel_stage`, which is precisely the field `bookAppointment` and
`acceptRecommendation` write. Book an appointment with the Log form already mounted and
the select still shows the pre-booking stage; the next submit writes it back. Moving the
*details* form to its own route does not help, because the offending form is the one that
stays.

What is actually wrong is narrower still: `updated_at` bumps on **every** write, including
no-ops, so the form remounts mid-typing and discards input. But the fix is **not** to
re-key the whole form on `funnel_stage`/`last_outcome` either — the Log update form now
owns three free-text fields (Note, Action Detail, and a long Interaction Summary
textarea). Type a summary, click **Accept** on a recommendation banner, and that key flips
too: same data loss, merely moved from "every write" to "every Accept, book or cancel".

Only the Stage select is stale, so reset **that one value** and leave the rest alone. A
`key` on the element cannot do this here: the stage picker is `AppSelect`, base-ui's
listbox, and `lead-fields-form.tsx:53-57` already records why —

> The three hand-set selects drive everything the engine derives, so they are controlled:
> base-ui's Select renders a listbox, not a native `<select>`, and never appears in
> FormData.

There is no native `<select>` to key, `defaultValue` is not read, and the value lives in
the parent's `useState` — so remounting the child would swap a listbox while the stale
`funnelStage` state sat in the parent and got submitted anyway. Reset the parent state
instead, during render, which is React's documented pattern for adjusting state when a
prop changes:

```tsx
const [funnelStage, setFunnelStage] = useState(lead.funnel_stage);
const [seenStage, setSeenStage] = useState(lead.funnel_stage);

// Render-phase reset: no effect, no flash, no extra commit.
if (lead.funnel_stage !== seenStage) {
  setSeenStage(lead.funnel_stage);
  setFunnelStage(lead.funnel_stage);   // the textareas are untouched
}
```

Nothing remounts. The stage follows a write from any other surface; the note, action
detail and interaction summary keep whatever is half-typed in them.

**Only the Stage select needs this, and only because it is pre-filled.** `last_outcome` is
written by three other surfaces too, but its control starts empty every render (see the
form table), so it has no stale value to carry. Were it ever pre-filled, it would need the
identical treatment — book an appointment with a pre-filled outcome select and the next
submit writes the pre-booking outcome over `'Appointment Booked'`.

The `/leads/[leadId]/edit` split still happens, for its own reason: it keeps the daily
form small and stops `editLeadDetails` and `logLeadUpdate` racing on one screen. It is not
the fix for this.

### The Log update form — the whole UX bet

One form, one submit, seven controls:

| control | notes |
|---|---|
| **Last Contact Outcome** | required select, and **it starts empty on every render — never pre-filled with the lead's current outcome.** The question is "what just happened in this conversation", which is a fact about the interaction being logged, not a stored value being edited. Starting empty means the control cannot carry a stale value, so no reset is needed for it even though three other surfaces write `last_outcome`. The lead's current outcome is visible in the derived strip above. |
| **What happened** | interaction type + direction, **pre-selected from the outcome** (Customer Replied → Inbound/Customer Message; Awaiting Customer → Outbound/Reply; No Response → Outbound/Follow-Up) and overridable |
| **Note** | optional, appended to the timeline |
| **Action Detail** | free text. **Never auto-populated** — the generic canned instructions ("Offer 2 appointment slots", "Establish need, timing and property details") are removed entirely; they became redundant noise in the spreadsheet |
| **Next Action Date** | date picker |
| **Funnel Stage** | pre-filled with the current stage; a recommended change is highlighted but not applied |
| **Interaction Summary** | optional textarea, pre-filled with the current value. **This form owns the field** — `logLeadUpdate` is the only action that writes it after creation, and the detail page renders it read-only. Requirement §25 lists it among the few things worth updating after a conversation, so it belongs on the daily form rather than behind an Edit-details round trip. |

Quote value / breakdown / sent date reveal only when the outcome is `'Quotation Sent'`.

**The sent date is a date picker writing a `timestamptz`, so the time of day must be
stated, not left to the driver.** It is stored as **Singapore midnight** —
`new Date(\`${date}T00:00:00+08:00\`)` — using the same `sgInstant` construction already in
`appointments.ts`. Not `now()`: `quote_valid_until` is `addDays(toSgDate(sent), 7)`, and a
quote entered at 9pm SG under a `now()` stored as UTC would read back as the following
calendar day and expire a day late. Midnight is also what makes back-dating a quote
("I sent this on Monday") behave.
When the outcome is `'Appointment Booked'`, the form points at the existing booking
dialog rather than duplicating it.

### `/leads/[leadId]/edit` — everything else

Identity, contact channel + lead source, inbound/outbound, primary product, keys
collected, move-in date, assigned consultant, closure reason, archive. **No quote fields
and no interaction summary** — both belong to the Log update form; see "Field ownership"
below.
`closure_reason` is **required** when the stage is `'Lost'` or `'Not Qualified'` (Zod
`superRefine`).

### `/leads/new` — manual lead entry

Currently six fields, two of which are about to become invalid: it posts `lead_status`
(trigger-owned from now on) and `funnel_stage` from the old vocabulary, and `createLead`
hard-codes `source: 'manual'`.

Rewritten to: Name, Mobile, Development, **Contact Channel**, **Lead Source**,
**Inbound / Outbound**, **Primary Product**, Funnel Stage (default `'Qualify Lead'`),
Interaction Summary. **No Lead Status field** — it derives.

### Validation

`src/lib/validation/lead.ts` needs the same rewrite as the actions: `leadCreateSchema`
drops `lead_status`, `buying_readiness`, `keys_status` and `expected_key_date`; gains
`contact_channel`, `source`, `inbound_outbound`, `primary_product`, `keys_collected`,
`move_in_date`, `closure_reason`, `assigned_consultant_id`; renames `action_date` →
`next_action_date` and `action_detail_override` → `action_detail`. Split into
`leadCreateSchema`, `leadDetailsSchema` (for `editLeadDetails`, `.partial()`-friendly)
and `logUpdateSchema`. `closure_reason` required when the stage is `'Lost'` or
`'Not Qualified'`, via `superRefine`.

### Nav

`src/components/nav/links.ts` gains **Queue** as the first entry (consultant + admin),
ahead of Leads. `ops` still has no lead access.

---

## Server actions

### Field ownership — one writer per field

The whole phase turns on not having two things write the same value. That applies to
actions as strictly as it does to fields:

| field group | owner |
|---|---|
| `action_detail`, `interaction_summary` | `logLeadUpdate` — **sole writer** |
| `funnel_stage`, `last_outcome`, `next_action_date` | `logLeadUpdate` **plus the appointment lifecycle** — see below. These three are the contested ones. |
| `latest_quote_cents`, `quotation_breakdown`, `quotation_sent_at`, `quote_valid_days` | **`logLeadUpdate`.** Quoting is something that happens *in a conversation*, so it belongs to the daily form and is revealed when the outcome is `'Quotation Sent'`. **Removed from `/leads/[leadId]/edit`** — an earlier draft listed it in both places, which is the same two-owner bug this table exists to prevent. |
| identity, channel, source, direction, product, keys, move-in, consultant, closure reason, archive | `editLeadDetails` |
| `lead_status`, `unanswered_followups`, `last_message_by`, `last_contact_at`, `last_customer_response_at` | database triggers — **no action writes these** |

**The three contested fields have five writers between them.** Understating this is how a
partial `set` ends up clobbering, and how a mounted form goes stale without anyone
noticing, so the full list:

| field | written by |
|---|---|
| `funnel_stage` | `logLeadUpdate`, `acceptRecommendation`, `bookAppointment` (→ `'Attend Appointment'`), `setAppointmentStatus` (`completed` → `'Send Quotation'`; cancel/no-show → restore) |
| `last_outcome` | `logLeadUpdate`, `acceptRecommendation` (when `clearsOutcome`), `bookAppointment` (→ `'Appointment Booked'`), `setAppointmentStatus` (null on `completed`, restore on cancel/no-show) |
| `next_action_date` | `logLeadUpdate`, `bookAppointment`, `rescheduleAppointment`, `setAppointmentStatus` (null on `completed`, restore on cancel/no-show) |

Every one of those writers except `logLeadUpdate` is on the lead detail page, which is
exactly why the Log update form's staleness needs handling rather than assuming. `next
_action_date` is not in that fix because it is a date input the user re-picks each time,
not a pre-filled mirror — but it is worth knowing it moves under them.

### Clearing `dismissed_recommendations`

The clear rule belongs to **both** write actions, not just the daily one. Extract it as a
shared helper and call it from `logLeadUpdate` **and** `editLeadDetails`:

```ts
const RECOMMENDATION_INPUTS = [
  "funnel_stage", "last_outcome", "quotation_sent_at",
  "quote_valid_days", "move_in_date",
] as const;
```

Four of the five belong to `logLeadUpdate`; **`move_in_date` belongs only to
`editLeadDetails`**. So leaving the clearing in `logLeadUpdate` alone reintroduces the
stuck banner on the exact field the widened list was written for: dismiss `move-in-near`,
set the move-in date from the edit page, and the warning stays suppressed forever.

| action | change |
|---|---|
| **`logLeadUpdate`** | **new — the daily driver.** One transaction: insert `lead_interactions`, partial-update the lead (outcome / action detail / next action date / **interaction summary** / optional stage / optional quote fields), insert `lead_stage_events` if the stage moved, clear `dismissed_recommendations` when any recommendation input changed. Counter and status follow via triggers. **`interaction_summary` is written here and nowhere else** after `createLead` — it is deliberately absent from `editLeadDetails`, so the field has exactly one owner. |
| **`editLeadDetails`** | **also clears `dismissed_recommendations`** — it owns `move_in_date`, one of the five inputs, and the only one the daily form never touches. Replaces `updateLead`. **Must build a partial `set`** from a Zod `.partial()` parse. With two write paths on one lead, a surviving full-row update means saving a phone number NULLs the outcome and action detail just entered. Outcome / action detail / next action date stay out of this action entirely. Adds optimistic concurrency (`.where('updated_at','=',expected)`), reusing the error shape already in the house at `appointments.ts:159-163`. |
| **`archiveLead`** | currently takes a raw string with **no Zod and no uuid check** (`leads.ts:91`) and flips the queue's hard filter. Add validation and wire it to the UI. |
| **`createLead`** | **needs a full rewrite, not a rename.** `leads.ts:24-55` writes `lead_status` (about to be trigger-owned and silently discarded), `source: 'manual'` (that column becomes `contact_channel`, and the new `source` means something else entirely), and all three dropped free-text columns. It must instead write `contact_channel`, `source`, `inbound_outbound`, `primary_product`, `funnel_stage` and never touch `lead_status`. |
| `acceptRecommendation` / `dismissRecommendation` | new, role-guarded. Applies `suggestedStage`, writes a `lead_stage_events` row, and sets `last_outcome = null` when the recommendation carries `clearsOutcome`. |
| `bookAppointment` | stage → `'Attend Appointment'`, outcome → `'Appointment Booked'`, writes a `lead_stage_events` row with `source = 'system'`, and **requires `assigned_consultant_id`** — which is a schema *and* UI change, not a one-liner: `appointmentCreateSchema` has no consultant field and `book-appointment-dialog.tsx` does not collect one. Add a required consultant select to the dialog (options = `profiles` where `role in ('consultant','admin')` and `is_active`), a `consultant_id: z.string().uuid()` to the schema, and write it to `leads.assigned_consultant_id` in the same transaction. |
| `rescheduleAppointment` | writes `leads.action_date` today (`appointments.ts:114-118`) → `next_action_date` after the rename. Also logs an `'Appointment'` interaction so the timeline shows the move — which means **capturing `requireRole`'s return value** for the interaction's `created_by`; it is discarded today at `appointments.ts:97`. |
| `setAppointmentStatus` | **writes a `lead_stage_events` row on every transition that moves the stage** — `completed` and cancel/no-show both do, and an earlier draft recorded neither, losing exactly the appointment transitions stage-duration analytics most want. `source = 'system'`, `changed_by` = the session user — which means **capturing `requireRole`'s return value**, discarded today at `appointments.ts:128`. `bookAppointment` already binds it (`:22`); these two are the only actions in this table that don't. `completed` → stage `'Send Quotation'`, outcome `null`. Cancel/no-show still restores **all three** snapshot fields — the reasoning at `appointments.ts:170-192` holds under the new cascade too. The hardcoded `'Qualified / Pre-Appointment'` fallback at `appointments.ts:196` becomes `'Book Appointment'`. |
| **`revalidateLead(leadId)`** | new helper centralising `/queue` + `/leads` + `/leads/[id]` revalidation, before the sixth call site exists |

Every action keeps `await requireRole(["consultant","admin"])` + Zod, per
`rules/code/server-actions.md`. Access control is unchanged from Phase 15: consultant +
admin full access, `ops` locked out, no hard deletes.

---

## Testing

### The 13 acceptance tests

Written **first**, in `src/lib/leads/funnel-engine.test.ts`:

| # | scenario | expected |
|---|---|---|
| 1 | New enquiry | Qualify Lead / Active / `Qualify Lead` |
| 2 | Keys not collected, move-in 6 months out, user sets Nurture | Active, Readiness Low, `Nurture Lead`, future date accepted |
| 3 | Renovating, comparing vendors, asks for catalogue | Activate / Active / Customer Replied / `Reply Required`, due today. After sending: Awaiting Customer |
| 4 | Book Appointment stage, customer asks about pricing | `Reply Required`, **stage stays Book Appointment** |
| 5 | Book Appointment stage, "your price looks higher" | Pre-Appointment Barrier → `Resolve Appointment Barrier`, status stays Active |
| 6 | Outcome Appointment Booked | recommends Attend Appointment, consultant required, `Confirm / Attend Appointment` |
| 7 | Quote $2,500 sent | Quotation Sent, recommends Collect Deposit, `Push for Deposit`, valid-until = +7d, pipeline $2,500 |
| 8 | Quote unconfirmed past 7 days | recommends Decision Pending. **Before accepting**, the action stays `Push for Deposit` (`'Quotation Sent'` is a branch-4 override). **After accepting** — which sets the stage *and* clears the outcome — the action is `Push for Decision`, unless a barrier outcome overrides it |
| 9 | Collect Deposit / Decision Pending + Post-Appointment Barrier | `Resolve Closing Barrier` |
| 10 | Customer Confirmed | outcome alone → action `Won`, status still `Active`, lead appears in the **Needs closing** group with a `customer-confirmed` recommendation. Accepting it → stage `Won` / `Closed – Won` / **absent from the queue** |
| 11 | Not Qualified + closure reason Small Order | Closed – Not Qualified, absent from queue |
| 12 | Lost + closure reason Competitor | Closed – Lost, absent from queue |
| 13 | Reply Mon (0) → Follow-Up Wed (1) → Follow-Up Fri (2) | Unresponsive; returns to queue when its date is due; a reply resets to 0 / Active / Customer Replied |

Plus, each covering something the 13 alone would miss:

- a table test pinning the **terminal-guard-above-outcome** ordering, and an
  exhaustive-switch totality check;
- boundary tests on the `'Awaiting Customer'` date gate (`date > today`, `date === today`,
  `date < today`, `date === null`);
- a `'Reply'` interaction does **not** increment the counter, but a `'Follow-Up'` does;
- **terminal outcome, non-terminal stage** → status `Active`, `dueStatus = 'Closed'`, a
  `customer-confirmed` recommendation present, and the row lands in **Needs closing**
  (R8);
- **`deriveCurrentOwner` on a `'Won'` lead returns `assigned_consultant_id`**, not the
  pre-sales owner — the `STAGE_RANK`-vs-`FUNNEL_POSITION` trap;
- accepting `quote-aged` clears the outcome and only then yields `'Push for Decision'`;
  and accepting `customer-confirmed` **preserves** it;
- `'Not Qualified'` returns the pre-sales owner while `'Won'` and `'Lost'` do not;
- `deriveRecommendations` returns `[]` for all three terminal stages — specifically, a
  `'Not Qualified'` lead with a stale `'Appointment Booked'` outcome gets **no** banner;
- an `Unresponsive` lead with a terminal outcome and a future `next_action_date` still
  appears in **Needs closing** (the date gate does not apply there);
- dismissing `move-in-near` then changing `move_in_date` re-raises the banner — asserted
  against **`editLeadDetails`**, since that is the action that owns the field;
- `move-in-near` carries no `suggestedStage`, and `acceptRecommendation` **throws** on a
  code that has none rather than writing a null-to-null stage event;
- the stage-agreement rules, over the fixture: exactly **7** of the 29 `'Quotation Sent'`
  rows are nulled (3 `'Decision Pending'` + 4 `'Nurture Lead – Long Term'`), 3 keep the
  outcome, and exactly **1** lead is forced to `'Attend Appointment'` (index 242);
- **no non-terminal migrated lead has an action implying a stage ahead of its own.**
  Define it concretely — map each action to the minimum funnel position it implies
  (`Qualify Lead` 0 … `Push for Decision` 7; `Resolve Closing Barrier` 5; `Reply
  Required`, `Follow-Up`, `Awaiting Customer` and `Resolve Appointment Barrier` are
  stage-agnostic, being customer-driven) and assert no lead exceeds its own position. This
  is **0** with both forces in place and **1** without the appointment force, so it is a
  real gate rather than a tautology;
- `setAppointmentStatus` writes a `lead_stage_events` row on `completed`, `cancelled` and
  `no_show`, and Migration 4 leaves exactly one backfilled event per lead;
- **the force pass is idempotent** — run it twice over all 244 rows and the second run
  changes nothing. This is the guard against the mutual dependency between the stage and
  outcome passes.

### Keep and repurpose the 244-row fixture

`__fixtures__/spreadsheet-parity.json` holds 244 real, anonymised input tuples and is
**completely independent of the retired spreadsheet** (which no longer exists on disk —
`npm run leads:verify` is already broken and its script is deleted in this phase). Strip
the `expected` blocks, which are pinned to the dead model, keep the `input` blocks, and
repurpose the file as the migration acceptance gate:

1. every row maps to a legal `(stage, outcome)` pair with no illegal nulls;
2. **pin the number of rows whose `deriveActionRequired` is neither `'Closed'` nor
   `'Won'`: 43 under the correct cascade, 179 under a literal reading.** Measured, not
   estimated — see below;
3. pin queue visibility separately: 43 rows have a non-closed `lead_status` (39 `Active`
   + 4 `Unresponsive`);
4. snapshot `deriveLead` over all 244 so the next refactor has a diff.

The 43 / 179 split, measured over the fixture with the mapping tables above:

| | correct | literal |
|---|---|---|
| terminal-stage leads holding `Closed`/`Won` | 201 | 65 |
| terminal-stage leads that escape | 0 | **136** |
| non-terminal leads with an open action | 43 | 43 |
| **total open actions** | **43** | **179** |

The 65 that survive a literal reading break down as 33 `'Customer Confirmed'` and 25
`'Customer Declined'` — caught by branch 2, which is a terminal *outcome* — plus **7 whose
`'Appointment Completed'` → `null` mapping means no outcome branch matches at all**, so
they reach the terminal guard wherever it sits. ("Literal" here means the guard moved
*below* the outcome branches but still above the stage switch; that is the only variant
that is even expressible, since branch 5's switch has no terminal cases.)

Those 7 are why the pin measures the cascade **and** the outcome mapping together: give
`'Appointment Completed'` a non-null mapping and they join the escapees at 143.

Neither stage-agreement rule perturbs any of this — verified. The outcome force nulls 7
outcomes on non-terminal leads that stay open either way; the stage force moves one lead
between two non-terminal stages. 43 / 179 / 136 are unchanged, and the count of
non-terminal leads whose action implies a stage ahead of their own goes to **0**, which is
pinned separately.

**Do not pin the queue-visible count as the cascade-ordering gate.** It is insensitive to
the bug. Running both orderings over the fixture: under a literal reading those 136
terminal leads escape `Closed`/`Won` in `deriveActionRequired` — but every one of them
still carries a terminal `funnel_stage`, and `deriveLeadStatus` checks terminal stages
first, *independently of the cascade*, so they are still `Closed – *` and the `/queue` SQL
filter still excludes them. The queue count is **43 under both orderings.** Only the
action distribution moves (43 → 179), so that is what the gate must measure.

Worth stating plainly: under this design the literal ordering **is not even expressible.**
Branch 5's exhaustive `switch` has no `Won` / `Lost` / `Not Qualified` cases, so moving
the terminal guard below the outcome branches is a *compile error*, not a silent
behaviour change. That is a stronger guarantee than a test, and the test exists to catch
someone who "fixes" the compile error by adding the missing cases.

`spreadsheet-parity.test.ts` is 248 of the suite's **849** tests — 29%. The replacement
must come in at comparable volume or the safety net quietly halves. Budget it as a line
item, not a hope.

### Enum-literal parity test

A test that reads `data/migrations/202608281000_lead_enums.ts` **as text** and asserts
every enum label appears character-for-character against `funnel-types.ts`. Migrations
are frozen snapshots and cannot import from `src/`, so the literals are necessarily
duplicated — and the five en-dash values (`'Closed – Won'`, `'Nurture Lead – Long Term'`,
`'Activate Lead – Short Term'`, `'Closed – Lost'`, `'Closed – Not Qualified'`) are a
silent-failure class: a hyphen-minus typed in one file against a copy-pasted en-dash in
the other type-checks nowhere and fails at runtime with `invalid input value for enum`.
Ten lines, catches the whole class.

### `scripts/verify-derivations.ts` (`npm run leads:check`)

Reads every lead and asserts that the SQL-derived `lead_status` equals TypeScript
`deriveLeadStatus`. This is the only cover for the two trigger-maintained values — see
Risk R6.

**One of its checks must not be the obvious one.** "Assert `unanswered_followups` equals a
fresh recount from `lead_interactions`" is **circular**: the trigger computes the column
*from* that table, so the recount agrees with the column whenever the trigger is
self-consistent — including when the interaction seed is wrong and every value is 0. It is
worth keeping as a cheap trigger-consistency check, but it proves nothing about the
migration. Add three assertions that reach outside the loop, each comparing against
`lead_legacy_import` rather than against the trigger's own inputs:

| assertion | expected |
|---|---|
| `unanswered_followups` grouped | 2 on the 117 rows whose sidecar `lead_status` is `'Unresponsive'`; 1 on the 11 whose sidecar `last_outcome` is `'Follow-Up Sent'` and status is not; 0 on the other 116 |
| `lead_status = 'Unresponsive'` | exactly **4** — the non-terminal subset of those 117 |
| the three timestamps | equal to the sidecar's, to within 2 seconds (the 1-second floor in the interaction seed) |

Run it immediately after Migration 4 as well as before each deploy. The seed only has to
survive one wrong `INSERT` to be gone.

### Manual

`npm run dev`, walk all 13 acceptance tests as a consultant. Plus: cancel an appointment
**booked before the migration** (proves the snapshot conversion); confirm the 238
migrated free-text notes are visible in timelines; mobile QA at 375×667 on `/queue`,
`/leads` and both detail pages per `rules/ui/responsive.md`.

---

## Implementation order

Steps 1–4 are pure TypeScript and land **before any DDL**, so the mapping and the cascade
are proven correct before the database is touched. Do not proceed past a red step.

1. `funnel-types.ts` — new unions + `as const satisfies` tuples. Old `types.ts` untouched
   so the legacy engine keeps compiling. *Verify:* `tsc` clean, suite green.
2. `funnel-engine.ts` + tests — **13 acceptance tests first**, then the implementation.
3. `migration-map.ts` + a test asserting both maps are total over the old unions.
4. Repurpose the fixture as `migration-parity.test.ts`; assert the **action
   distribution**. *Rows whose action is neither `'Closed'` nor `'Won'` must be **43**. If
   it's 179, step 2 has the cascade bug.* Also assert queue visibility is 43 (39 `Active`
   + 4 `Unresponsive`) — useful, but not the cascade gate.
5. Migration 1 (enums) → `db:migrate` + `db:codegen`. *The resulting `tsc` error list is
   the work queue for steps 11–14.* **Retire `scripts/import-leads.ts` in this step, not
   at the end** — `tsconfig.json` includes `**/*.ts` from the repo root, so the importer
   is type-checked, and it writes the legacy vocabulary throughout. It would keep the
   error list permanently red, and it targets a spreadsheet that no longer exists on disk.
   Remove the `leads:import` npm script in the same commit, not later.
6. Migration 2 (sidecar). *Verify:* 244 rows.
7. Migration 3 (columns + conversions). *Verify:* group-by counts match the mapping tables.
8. Migration 4 — tables → **interaction seed** → stage-event seed, in that order. The seed
   writes the trigger's *inputs*, never the counter; read that section in full first, it
   is the highest-consequence step here. *Verify:* `unanswered_followups` groups
   **117 / 11 / 116**; the three timestamps match `lead_legacy_import` to within 2 seconds;
   counter moves on delete.
9. Migration 5 (status trigger). *Verify:* zero closed-and-not-closed rows, and exactly
   **4** leads at `lead_status = 'Unresponsive'`.
10. `scripts/verify-derivations.ts` + `npm run leads:check` — **run it here, immediately**,
    not only before deploy. Steps 8 and 9 are the two it exists to police.
11. Server actions rewritten. *Verify:* the step-5 error list is empty.
12. `/queue` route. *Verify:* row count matches the step-4 pinned number.
13. `/leads` database view + filters; nav updated.
14. `/leads/[leadId]` + `/leads/[leadId]/edit`; the remount key moved off the form and
    onto the Stage select alone. *Verify:* with the Log form open and a note half-typed,
    book an appointment — the stage select must follow the write, a save must not write
    the pre-booking stage back, **and the half-typed note must survive.** A key on the
    whole form passes the first two and fails the third.
15. Delete `queue-engine.ts`, `queue-engine.test.ts`, `types.ts`, the old
    `spreadsheet-parity.test.ts` (its fixture survives, rewritten as
    `migration-parity.test.ts` back in step 4), `scripts/verify-lead-engine.ts` and the
    `leads:verify` npm script — one commit, once nothing imports them. (`import-leads.ts`
    and `leads:import` went at step 5.)
16. Update `CLAUDE.md` and `rules/`; mark this spec implemented.

---

## Risks

**R1 — Cascade ordering.** The highest-severity detail in the phase. A literal reading of
"outcome overrides stage" gives 136 of the 201 terminal leads a live Action Required
(43 → 179). Mitigated three ways: the terminal guard at branch 1; branch 5's exhaustive
`switch`, which makes the wrong ordering a compile error rather than a silent change; and
the fixture's **action-distribution** pin at step 4. Note the queue-visible count is
*insensitive* to this bug and must not be used as the gate.

**R2 — `updateLead`'s full-row update becomes actively destructive.** Today one form owns
the row, so the round-trip hack at `lead-fields-form.tsx:84-87` contains the damage. With
two write paths, a surviving full-row `set` means saving a phone number NULLs the outcome
and action detail just entered. Mitigated by partial `set` + optimistic concurrency.

**R3 — En-dash drift** between the migration literals and `funnel-types.ts`. Type-checks
nowhere, fails at runtime. Mitigated by the enum-literal parity test.

**R4 — Pre-migration appointment snapshots.** `lead_stage_before` / `lead_outcome_before`
hold legacy enum values; if not converted in Migration 3, the first cancellation after
cutover writes an invalid enum into `leads`. Mitigated by converting in place and by the
manual cancel test on a pre-migration appointment.

**R5 — `'Customer Needs Time'` and `'Renovation Delayed'` losing their date protection.**
`'Awaiting Customer'` is date-gated, so all 7 rows need an explicit `next_action_date` in
the migration or they surface as `Follow-Up` on cutover morning.

**R6 — The trigger/TypeScript seam is the one place vitest cannot reach.** `lead_status`
and `unanswered_followups` are computed in PL/pgSQL. There is no DB test harness in this
repo. `scripts/verify-derivations.ts` must be run before each deploy; this is a stated
limitation, not an oversight.

**R7 — Test volume.** The suite is at **849 tests** today (39 files, verified
2026-08-27). 248 of them are the parity suite. Deleting them without replacing the
coverage halves the safety net silently; the phase should finish at 849 or above.

**R8 — Recommendations are the only exit from a terminal outcome.** `deriveLeadStatus`
reads the stage, so an outcome of `'Customer Confirmed'` with a non-`'Won'` stage leaves
the lead `Active` and in the queue indefinitely. The `customer-confirmed` /
`customer-declined` recommendations plus the pinned **Needs closing** group are the whole
mitigation — if either is dropped during implementation, leads silently accumulate there.
Cover it with an acceptance test, not just the manual walkthrough.

**R9 — Migration step ordering within file 3.** Four renames, a column drop and an index
drop must all precede the `add column` calls. Getting it wrong fails the migration
outright rather than silently, but since `data/migrate.ts` runs everything in one
transaction, a failure here rolls back migrations 1 and 2 as well.

**R10 — Backfilled `unanswered_followups` is inference, not observation.** We are asserting
that a lead marked `Unresponsive` in the spreadsheet received exactly 2 unanswered
follow-ups, and inserting two synthetic `'Follow-Up'` interactions that say so. It
reproduces the *state* correctly but the *count* is reconstructed. The synthetic rows are
labelled as such in the timeline, and the first real interaction recomputes the counter
from actual data — genuinely self-healing, now that the seed lives in the same table the
trigger reads. Until then, "unanswered follow-ups: 2" on a migrated lead means "the
spreadsheet said they went quiet", not "we counted two messages".

**R11 — The interaction seed is destroyable by any later `INSERT` that runs before it.**
The counter, `last_contact_at`, `last_customer_response_at` and `last_message_by` are all
recomputed from `lead_interactions` on every write to it. Seed them wrong — or seed a bare
`'Note'` first and call it done — and all four are silently reset across 244 leads, with
`Unresponsive` disappearing entirely. Neither the fixture pin nor a recount-based check
catches it; only the sidecar comparisons above do. This is the single highest-consequence
step in the migration and the one to run `leads:check` against immediately.

---

## Migration assumptions

1. Legacy values are archived in `lead_legacy_import`, never destroyed. The table is
   dropped only on explicit sign-off.
2. `'Appointment Completed'` (7 rows) maps to a `null` outcome. The fact survives in
   `appointments.status`; the outcome vocabulary is deliberately narrowed to what the
   *customer* did.
3. Free text that cannot be parsed into `keys_collected` / `move_in_date` becomes `NULL`
   and stays readable in the timeline. Nothing is guessed.
4. `owner_id` is left exactly as imported — every lead points at Alan — and
   `assigned_consultant_id` is null on all 244, because the column is new. The
   consequences are deliberate and worth stating: pre-appointment leads derive Jay (the
   pre-sales owner) and the stale `owner_id` has no effect; the 41 `'Won'` and 54
   `'Lost'` leads fall through `assigned_consultant_id ?? owner_id` to **Alan**, which is
   correct — he did work them; the 106 `'Not Qualified'` leads sit at funnel position 0
   and derive Jay, which is also right, since a lead disqualified during qualification
   never reached a consultant.
5. `first_initiated_at` keeps its imported value untouched. `last_contact_at` and
   `last_customer_response_at` are **handed to the trigger and recomputed**, landing back
   on their imported values *by construction* — the interaction seed places rows at
   exactly those timestamps — rather than by being left alone. The distinction matters:
   the round trip is verified against `lead_legacy_import`, to within the 2 seconds the
   seed's ordering floor can introduce. From cutover all three are maintained by the
   trigger.
6. The 15 `'Qualified / Pre-Appointment'` leads and the 11 `'Nurture'` leads are expected
   to need a manual review pass in the first week. That is a deliberate trade, not a gap.
7. **`quotation_sent_at` is not backfilled — it is `NULL` on all 244.** The spreadsheet
   never recorded a quote date, so there is nothing to backfill from, and inventing one
   from `last_contact_at` would fabricate the input to a recommendation. The consequence
   is specific and worth stating: `quote_valid_until` is null for every migrated lead, so
   **`quote-aged` can never fire on them.**

   Of the 29 leads carrying `'Quote Sent'` → `'Quotation Sent'`, 19 are terminal and 7
   have their outcome nulled by the stage-agreement rule, leaving **3 at
   `'Collect Deposit'`** that keep it. Those 3 are exactly the ones that seed
   `unanswered_followups = 2`, and all three have an `action_date` already in the past —
   so they land **Overdue** with `Push for Deposit`, which is right, but they will never
   age into `'Decision Pending'` on their own. They are the entire manual burden this
   assumption creates: three rows, named, to be moved by hand if the quote is stale.
   **Quote aging starts working for quotes sent after cutover.**

---

## Out of scope, worth doing later

- Analytics dashboards over the schema this phase enables (conversion by source/channel,
  quote→deposit rate, stage durations from `lead_stage_events`, closure-reason mix)
- WhatsApp / Telegram ingestion writing `lead_interactions` directly — the trigger is
  already designed for it
- Customer duplicate merging
- Multi-owner assignment / round-robin
- Dropping `lead_legacy_import` once the review pass is done
- `'Both'` as a `primary_product` value is a modelling compromise: a lead can want
  curtains *and* blinds *and* mesh. Three booleans or a `text[]` would be honest. The
  requirement asks explicitly not to overcomplicate product breakdown yet, so the
  three-valued enum ships — flagged here as the thing to revisit when cross-sell
  reporting becomes real.
