# Phase 15 — Leads, Daily Queue & Appointments

**Status:** Specified, not implemented
**Supersedes:** `02 Leads Management & Appt.xlsx` (244 leads, hand-maintained)

## Why

The CRM begins at "a consultant is on-site measuring". Everything before that — the
enquiry, the qualification, the follow-up, the booking — lives in a spreadsheet that
one person (Alan) maintains by hand. That spreadsheet is not a list; it is a
**funnel engine**. Three fields are typed by a human and eight formula columns derive
what to do next, how urgently, and whether the lead should be shown at all.

This phase ports that engine into the CRM, adds the appointment record the spreadsheet
never had, puts the appointment on a shared Google Calendar, and closes the seam between
a `Won` lead and a new consultation.

### The seam being closed

The spreadsheet ends at `Won` (41 leads). The CRM starts at `/orders/new`. They share a
customer, and today that customer is retyped. After this phase, booking an appointment
creates or matches the customer, and "Start consultation" carries it into the order form.

## What the spreadsheet actually contains

Six sheets; two hold data.

| Sheet | Role |
|---|---|
| `Leads` | 29 cols × 244 rows. A–H, J, L, O–V and AA–AC hand-typed. **I, K, M, N, W, X, Y, Z are formulas.** |
| `Daily Queue` | Flattened, priority-sorted worklist |
| `Dashboard` | `COUNTIF` tallies by funnel stage and by action |
| `Lists` | Enum definitions (3 enums + priority ranking) |
| `How to Use` | The documented rulebook |
| `WhatsApp Import` | 59-row staging area for bulk ingest — **out of scope** |

**Current state:** 244 leads, all owned by Alan. 178 Telegram (`TG-`), 66 WhatsApp (`WA-`).
40 leads are queue-visible, 12 of them "Contact Today". 105 excluded as ghosted, 95 closed.
98 leads carry a mobile; 136 carry a development; 54 carry a quote value.

## Scope

**In:** leads table + import, the derived engine, Daily Queue screen, appointments,
shared-calendar sync, customer matching, "Start consultation" prefill.

**Out:** WhatsApp/Telegram auto-ingest (the `WhatsApp Import` sheet stays manual),
the Dashboard analytics screen, multi-owner assignment, customer self-booking,
installation/delivery appointments, merging the customer duplicates that already exist.

## Decisions taken

| Decision | Choice | Reason |
|---|---|---|
| Booking source | Staff-entered in the CRM | No public surface, no slot logic, no spam handling |
| Calendar target | One shared company Google Calendar via service account | No per-user OAuth; staff subscribe from their own Google Calendar |
| Customer invited to event | No — internal event only | Customer contact stays on WhatsApp; the CRM never emails a customer unprompted |
| Appointment → order | "Start consultation" prefills `/orders/new` | Nothing is created until the consultant actually works; no junk drafts from no-shows |
| Customer identity | Match on mobile via a picker | Stops new duplicates without backfilling old ones |
| Appointment types | Consultation only | Proves the calendar integration before pointing it at ops |
| Enum fidelity | Port verbatim | The 244 rows import with zero judgement calls, and CRM output can be diffed against Excel to prove the port |

## Data model

Three new tables, two additions. The eight formula columns are **not stored** — they
depend on `TODAY()` and are derived at read time.

### `leads`

```
id                          uuid pk
lead_ref                    text unique      -- 'TG-28786858' / 'WA-6581817358'; see import hazards
source_ref                  text             -- the sheet's Lead ID verbatim, NOT unique
source                      lead_source      -- telegram | whatsapp | manual
name                        text not null    -- Excel 'Customer'
mobile                      text             -- 98 of 244
development                 text             -- 136 of 244
initiator                   lead_initiator   -- Customer | Us
funnel_stage                lead_funnel_stage
lead_status                 lead_status
last_outcome                lead_outcome
action_detail_override      text             -- col J; wins over derived Next Action
action_date                 date             -- col L, manual
first_initiated_at          timestamptz
last_contact_at             timestamptz
last_customer_response_at   timestamptz      -- col T; drives the 90-day stale rule
interaction_summary         text
historical_summary          text
latest_quote_cents          integer          -- col P, integer cents
buying_readiness            text             -- free text: 'Mid-Sep', 'Early Jan 2027', 'ASAP'
keys_status                 text
expected_key_date           text             -- free text, not a real date in the sheet
owner_id                    uuid → users
telegram_chat_id            text
customer_id                 uuid → customers -- null until an appointment is booked
is_archived                 boolean          -- no hard deletes
created_at / updated_at
```

Only **three** Postgres enums, because `Lists` defines only three. `buying_readiness`
stays `text` because the sheet holds `'Mid-Sep'`, `'Early Jan 2027'`, `'Early Oct'` and
`'ASAP'` in it. `expected_key_date` stays `text` because its two non-empty values are
one real date and the phrase `'Not collected yet'`. Coercing either column to a date
would invent data. `keys_status` stays `text` for the same reason as the others: it is
not in `Lists`, so it is not a closed set.

`'-'` occurs exactly once in the entire sheet — in the `Customer` column of row 118,
which is the one `NOT NULL` column it can break. Blank cells elsewhere are genuinely
empty rather than dashed. Both are imported as `NULL`; see the import section for how
the two nameless leads are handled.

**Enum values, verbatim:**

- `lead_funnel_stage`: New Lead · Not Qualified · Qualified / Pre-Appointment ·
  Appointment Booked · Post-Appointment / Quote Pending · Quote Sent ·
  Decision Pending · Nurture · Won · Lost
- `lead_status`: Active · Nurture · Ignore · Unresponsive · Won · Lost
- `lead_outcome`: Customer Replied · No Response · Ready to Book Appointment ·
  Barrier / Objection Raised · Appointment Booked · Appointment Completed ·
  Quote Requested · Quote Sent · Customer Needs Time · Customer Declined ·
  Order Confirmed

> The sheet also uses `Appointment Confirmed`, `Follow-Up Sent` and `Renovation Delayed`
> in the `Last Contact Outcome` column although `Lists` does not declare them.
> **The enum must include them** — 6, 63 and 3 rows respectively depend on them,
> and `Appointment Confirmed` is branch 3 of the Action Required cascade.
> This is the first thing the import will trip on if missed.

### `appointments`

```
id                 uuid pk
lead_id            uuid → leads
customer_id        uuid → customers      -- resolved at booking
scheduled_at       timestamptz not null  -- date AND time; the sheet has neither
duration_mins      integer default 90
development        text
address            text
notes              text
status             appointment_status    -- scheduled | completed | cancelled | no_show
google_event_id    text
google_sync_state  google_sync_state     -- pending | synced | failed
google_sync_error  text
created_by / created_at / updated_at
```

### Additions

- `orders.appointment_id` — nullable FK. The Won→order seam. The lead is reachable
  through it, so no separate `lead_id` on orders.
- Index on `customers.mobile` — **non-unique**. Per-order customer creation has already
  produced duplicate mobiles; a unique constraint would fail on contact.

### Why leads and customers stay separate

146 of 244 leads have no mobile. They are conversations, not customers. A lead gains a
`customer_id` only when an appointment is booked — which is exactly where the customer
should first exist.

## The engine

A pure, tested TypeScript module: `src/lib/leads/queue-engine.ts`. No database
functions, no generated columns — the rules depend on the current date, so they are
computed per request. 244 rows is nothing to sort in memory.

**`TODAY()` means today in `Asia/Singapore`.** Computing it in UTC shifts every due-date
boundary by eight hours and puts leads in the wrong band for a third of the day.

### `deriveActionRequired(lead)` — col I, in order

1. `funnel_stage ∈ {Won, Lost}` → **Closed**
2. `funnel_stage = Not Qualified` OR `lead_status = Ignore` → **Ignore Lead**
3. `last_outcome = Appointment Confirmed` → **Attend / Confirm Appointment**
4. `last_outcome = Barrier / Objection Raised` → **Resolve Barrier**
5. `last_outcome = Customer Needs Time` → **Nurture / Re-engage**
6. `last_outcome = No Response` → **Follow Up – No Response**
7. `last_outcome = Ready to Book Appointment` → **Book Appointment**
8. `last_outcome = Customer Replied` → **Reply Required**
9. `funnel_stage = Nurture` → **Nurture / Re-engage**
10. `funnel_stage = New Lead` → **Qualify Lead**
11. `funnel_stage = Qualified / Pre-Appointment` → **Book Appointment**
12. `funnel_stage = Appointment Booked` → **Attend / Confirm Appointment**
13. `funnel_stage = Post-Appointment / Quote Pending` → **Send Quote**
14. `funnel_stage = Quote Sent` → **Follow Up Quote**
15. `funnel_stage = Decision Pending` → **Push for Decision**
16. else → **Review Lead**

Branches 3–8 sit **above** the stage branches. That ordering is the rule the sheet
documents as *"customer response overrides stage because the ball is with Drapeworks"*.
Preserve it exactly.

### `deriveNextAction(lead, action)` — col K

`action_detail_override` wins if set. Otherwise a fixed phrase per action:

| Action | Phrase |
|---|---|
| Reply Required | Reply to latest customer message |
| Qualify Lead | Establish need, timing and property details |
| Book Appointment | Offer 2 consultation slots |
| Attend / Confirm Appointment | Confirm / attend consultation |
| Send Quote | Prepare and send quotation |
| Follow Up Quote | Follow up on quotation and ask for decision |
| Push for Decision | Resolve barrier and ask for commitment |
| Nurture / Re-engage | Re-engage at the appropriate key / renovation timing |
| Follow Up – No Response | Send a value-adding follow-up / reactivation |

### `deriveEffectiveActionDate(lead, action)` — col M

`Closed` → none · `action_date` if set · `Reply Required`/`Send Quote` → today · else none.

### `deriveDueStatus` — col N

`Closed`/`Ignore Lead` → **Closed** · no effective date → **Schedule Date** ·
past → **Overdue** · today → **Due Today** · else **Upcoming**.

### `deriveContactPriority` — col X

1. `funnel_stage ∈ {Won, Lost}` OR action `Closed` → **Closed**
2. action ∈ {Reply Required, Send Quote} → **Contact Today**
3. effective date set: `≤today` → **Contact Today** · `≤today+3` → **Contact in 2–3 Days** ·
   `≤today+7` → **Contact Within 7 Days** · else **Future / Nurture**
4. no effective date: `Nurture / Re-engage` → **Future / Nurture** ·
   `Attend / Confirm Appointment` → **Contact Today** ·
   {Qualify Lead, Book Appointment, Follow Up Quote, Push for Decision,
   Follow Up – No Response} → **Contact in 2–3 Days** · else **Contact Within 7 Days**

### `deriveQueueVisibility` — col Z

1. `funnel_stage ∈ {Won, Lost}` OR action `Closed` → **Exclude – Closed**
2. `lead_status = Unresponsive` → **Exclude – Ghosted**
3. `funnel_stage ≠ Nurture` AND `last_customer_response_at` **is set** AND
   `last_customer_response_at < today − 90d` → **Exclude – Stale 90d+**
4. else → **Include**

The "is set" clause is not decoration. 48 leads have never responded and so have no
date; without the guard a null would compare as stale and silently drop them, 4 of
which are in today's queue.

### Queue ordering

Excel's `Queue Seq` (cols W and Y) is a running `COUNTIFS` — an artefact of needing a
sortable number in a spreadsheet. The app does not need it. Order by priority rank
(Today 1 → 2–3 Days 2 → Within 7 Days 3 → Future / Nurture 4), then effective action
date ascending, then name.

## Three bugs in the spreadsheet, carried knowingly

The port reproduces the formulas exactly, so it reproduces these. Each is recorded here
so the behaviour is a decision rather than a surprise, and each is a candidate for a
follow-up phase — **not** for silent correction during the port, because silent
correction destroys the ability to diff the CRM against the sheet.

1. **One `Ignore Lead` leaks into the queue.** `Contact Priority` falls through to
   *Contact Within 7 Days* for `Ignore Lead`, and `Queue Visibility` only excludes on
   `Unresponsive`. A `Not Qualified` lead that is still `Active` therefore shows up.
   Exactly 1 of 40 queue rows today.
2. **106 leads are counted nowhere on the Dashboard.** The Dashboard tallies 10 action
   values; `Ignore Lead`, `Resolve Barrier` and `Review Lead` are not among them, so
   all 106 `Ignore Lead` rows vanish from the counts. Out of scope here (no Dashboard
   screen this phase) but must not be "fixed" in the engine.
3. **`Resolve Barrier` has no Next Action text.** Branch 4 of the cascade produces an
   action that `deriveNextAction` has no phrase for, yielding an empty instruction.

The engine's test suite asserts all three behaviours. A test that asserts the *correct*
behaviour instead would fail the import diff.

## Screens

### `/leads` — Daily Queue (default) and All Leads

Two tabs over one table. Queue applies `Include` and the priority ordering; All Leads
shows everything with filters on stage, status, owner, and a search across name, mobile,
development and `lead_ref`.

Row shows: priority chip, action required, name, development, next action, effective
date with due-status colouring, last outcome, quote.

Follows the existing orders dashboard layout (`src/app/(app)/orders/page.tsx`) — same
table classes, same mobile-card breakpoint, teal-600 accents.

### `/leads/[leadId]` — Lead detail

The three hand-set fields (`funnel_stage`, `lead_status`, `last_outcome`) are the only
editable controls that matter; changing any one re-derives the whole panel. Also
editable: `action_date`, `action_detail_override`, summaries, quote, development, mobile.

Derived values render read-only with a note that they come from the engine.

Primary CTA depends on derived action: **Book Appointment** when the action is
*Book Appointment*, otherwise the appointment card if one exists.

### `/leads/new` — manual lead entry

For enquiries that arrive outside the import.

### Booking dialog

Opened from lead detail. Fields: date, time, duration (default 90), development,
address, notes, and the customer resolution block.

**Customer resolution:** searches `customers` by mobile then name, showing matches with
their order count so the right person is identifiable. Staff pick an existing customer
or create a new one from the lead's name and mobile. The chosen customer is written to
both `appointments.customer_id` and `leads.customer_id`.

On save: appointment row created, calendar event queued, `funnel_stage` set to
*Appointment Booked* and `last_outcome` to *Appointment Booked*.

### Nav

New `Leads` item, roles `["consultant", "admin"]`, placed first — it is the front of
the funnel. Added to `src/components/nav/links.ts`, which is the single link list.

## Google Calendar

**Service account, one shared calendar.** No per-user OAuth, no token refresh, no
`google` npm dependency beyond `googleapis` (or a direct signed-JWT fetch, which avoids
the dependency entirely — decide at implementation).

**Prerequisite, done by hand before this ships:** create a Google Cloud project, enable
the Calendar API, create a service account, and share the target calendar with the
service account's email at "Make changes to events".

Env: `GOOGLE_CALENDAR_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_KEY`.

**Railway service variables only — not Dockerfile build args.** These are read at
runtime on the server, and a private key passed as a build arg is baked into an image
layer that anyone who can pull the image can read. The existing `ARG` lines are all
`NEXT_PUBLIC_*`, which are public by definition; these are not.

**Event shape** — internal, no attendees:

```
summary:     Consultation — {customer name} ({development})
location:    {address}
description: Mobile: {mobile}
             Lead: {lead_ref}
             {notes}
             {app URL}/leads/{leadId}
start/end:   scheduled_at → +duration_mins, timeZone Asia/Singapore
```

**Failure handling.** The calendar is a side effect, never a gate. The appointment saves
with `google_sync_state = 'pending'`; sync runs after the transaction commits. On
failure the state becomes `'failed'`, the error is stored, and the lead detail shows a
"Calendar sync failed — Retry" affordance. **A Google outage must never lose a booking.**

Reschedule patches the existing `google_event_id`; cancel deletes the event. If the
event was never created, both are no-ops that clear cleanly.

## Import

`npm run leads:import` — a one-off script reading the local xlsx, idempotent on
`lead_ref` so it can be re-run.

**Not a seed migration.** `202608181700_seed_procurement.ts` sets the precedent for
seeding via migration, but migrations are committed. This payload is 244 real customer
names and 98 mobile numbers. The script keeps the PII out of git history; the
`.gitignore` entry for `*.xlsx` lands in the same commit.

Mapping notes:
- `Lead ID` prefix → `source`; the ID is kept verbatim in `source_ref`
- `Lead Owner` "Alan" → resolved to a profile row; the script fails loudly if absent
- Formula columns are ignored on import — they are re-derived

### Data hazards in the source

The sheet is a working document, not an export. Five shapes in it break a naive import,
each verified against the file:

1. **`Lead ID` is not unique.** Ten rows carry a bare `TG` (×8), `WA` (×2) or `WA-SEM`
   (×3) with no identifier attached. A unique index on the raw value fails outright,
   and an idempotent upsert keyed on it silently overwrites the wrong lead. The import
   therefore writes a synthetic `lead_ref` (`TG-row233`) and keeps the raw value in
   `source_ref`, which is not unique.

2. **168 date cells are raw Excel serials.** 59 `First Initiated Date`, 59 `Last Contact
   Date` and 50 `Last Customer Response Date` cells carry `number_format: General`, so
   a date-aware parser hands back the number `46087` rather than a date. Parsed
   naively they become `NULL` — and 50 missing `last_customer_response_at` values
   silently disable the 90-day stale rule for those leads. The import branches on
   numeric input: `Date.UTC(1899, 11, 30) + serial × 86_400_000`.

3. **`Latest Quote` holds free text on two rows** — `'688 Essential Night --> top $135
   for Signature Night'` and `'780 --> 660 after 15%'`. These are negotiation notes, not
   amounts. A numeric coercion yields `NaN` and the insert throws mid-run. The import
   extracts a leading number where one exists and preserves the full text in the
   interaction summary rather than discarding it.

4. **Two leads have no name.** Row 118's `Customer` is `'-'` and row 143's is blank.
   Both are ghosted `Not Qualified` leads, and both still carry an interaction summary
   worth keeping. `name` is `NOT NULL`, so the import falls back to the lead's own
   reference rather than dropping the row — inventing a placeholder would be worse, and
   dropping it would put the count at 242 and quietly lose two conversations.

5. **Rows below the data are not data.** Row 251 is an instruction to the operator, row
   253 is a helper block (`A=2026-08-10`, `B==TODAY()`, `C=B−A`) and row 254 is a
   counter. Row 253's first two cells are dates, so they survive an emptiness check and
   import as a lead. Both the import and the verification script bound their scan to
   rows whose `Lead ID` starts `TG` or `WA` — without that the fixture holds 246 cases
   instead of 244.

**Verification gate:** after import, a script recomputes the six derived values for all
244 leads and diffs against the values cached in the xlsx. The port is correct when the
diff is empty. This is the whole reason for porting the enums verbatim.

**Run it against `2026-08-21`, and work from a copy.** The sheet's `TODAY()` is frozen
at its last recalculation — 2026-08-21, confirmed three ways: every `Due Today` row has
an effective date of 2026-08-21, the earliest `Upcoming` is 2026-08-22, and the helper
cell `B253` holds `=TODAY()` cached at 2026-08-21. Opening the file in Excel
recalculates it and destroys that baseline permanently.

**What the gate does and does not prove.** The data exercises 9 of the cascade's 16
branches. `Barrier / Objection Raised`, `Send Quote` and outcome-driven `Reply Required`
have zero rows, so the gate never reaches the `TODAY()` branch of the effective-date
rule or the second branch of contact priority. In particular it **cannot** prove the
`Resolve Barrier` blank-instruction bug, because no lead is in that state. Of the three
known bugs the gate proves one — the `Ignore Lead` queue leak. The other two are
covered by unit tests only, which is why those tests are not optional.

### Retiring the spreadsheet

The xlsx is deleted once the import and the gate have both passed. That would normally
destroy the only evidence the engine is faithful, so the gate is frozen first into
`src/lib/leads/__fixtures__/spreadsheet-parity.json`: 244 input/expectation pairs
pinned to the sheet's final recalculation date, which the test suite replays forever.

The fixture is committed; the spreadsheet never is. That is safe because the engine
reads only six fields — stage, status, outcome, the override note, and two dates — and
none of them carries personal data. The override column was checked: 9 non-empty rows,
all generic sales notes. Names, mobiles, developments and summaries are all outside
what the engine sees, so none of them reach the fixture.

Deleting the spreadsheet is one-way. Confirm 244 rows are in the database, and keep a
backup outside the repository, before removing it. The `*.xlsx` ignore rule stays in
place afterwards — the next export should not be committable either.

## Access control

Server Actions are the access-control surface (`rules/data/rls.md`) — every action opens
with `requireRole`.

| Action | Roles |
|---|---|
| View leads / queue | consultant, admin |
| Create / edit lead | consultant, admin |
| Book / reschedule / cancel appointment | consultant, admin |
| Delete | nobody — `is_archived` only |

Ops has no lead access this phase; ops work starts at an order.

Policies are still written on both new tables per house rule, even though the app
connects as table owner and bypasses them.

## Testing

- **Engine unit tests** — every branch of all six derive functions, including the three
  known bugs. This is the bulk of the value; the engine is pure and cheap to cover.
- **Timezone tests** — a lead due "today" in Singapore at 07:00 SGT (23:00 UTC previous
  day) must read *Due Today*, not *Overdue*.
- **Import diff** — the 244-row verification gate above.
- **Calendar tests** — event payload shape; sync failure leaves the appointment intact
  with `state = 'failed'`; retry succeeds; reschedule patches rather than recreating.
- **E2E** — lead → book appointment → calendar event → start consultation → order
  carries the customer and `appointment_id`.

## Risks

| Risk | Mitigation |
|---|---|
| PII (244 names, 98 mobiles) committed to git | `.gitignore` for `*.xlsx` in the first commit; import via script, never a migration |
| Google service-account setup blocks the build | Sync is decoupled behind `google_sync_state`; everything but sync ships and is testable without credentials |
| Verbatim enums entrench a messy model | Explicitly deferred to a follow-up redesign phase, not resolved during the port |
| Undeclared outcome values break the import | Enum includes `Appointment Confirmed`, `Follow-Up Sent`, `Renovation Delayed` despite their absence from `Lists` |
| `Asia/Singapore` vs UTC date boundary | Dedicated timezone tests; a single `todayInSingapore()` helper used everywhere |

## Out of scope, worth doing later

1. WhatsApp / Telegram ingestion to replace the manual `WhatsApp Import` sheet
2. The Dashboard screen — and fixing the 106 uncounted leads
3. Funnel model redesign, collapsing the Won/Lost/Not-Qualified overlap
4. Merging the customer duplicates that per-order creation has already produced
5. Installation and delivery appointments on the same calendar, for ops
6. Multi-owner assignment — every lead is Alan's today
