# Phase 17 — Editable quotations until deposit

**Status:** Approved design 2026-09-24. Not yet implemented.

## Why

A quotation is not final until the customer pays the deposit, but the CRM treats
it as final the moment it is marked sent. Changing a sent quotation today means:

1. **Create revised quotation** — a new `order_quotations` row with a new
   `crm_quote_key`.
2. **Update Zoho draft** — because the key is new, Zoho creates a *second*
   estimate with a new QT number. The old estimate stays "sent" in Zoho.
3. **Confirm quotation sent** — again.

`syncQuotation` also refuses any Zoho estimate that is not a draft
(`src/lib/actions/quotations.ts`, "Only a draft Zoho quotation can be
updated"), so any drift sends the quote to **Needs reconciliation**. Revisions
never worked in production until `cd8927b` (the lines insert failed on jsonb),
which is how this surfaced.

Separately, most quotation actions throw plain `Error`s. Production Next.js
redacts those to a digest, so consultants see "An error occurred in the Server
Components render" instead of the reason.

## Outcome

- A quotation stays editable while the order is at `order_recorded` or
  `quotation_sent`. It locks when the deposit converts the estimate to a Zoho
  invoice (the order leaves `quotation_sent`).
- One Zoho estimate per order. Its QT number never changes; edits update it in
  place and refresh the stored PDF.
- **Confirm quotation sent** happens once, for the first send. Later edits only
  need **Update Zoho & refresh PDF**; the quote returns straight to Sent.
- Every quotation action shows its real, operator-written error message.

## Non-goals

- No change to the deposit / invoice / payment flow beyond what is listed under
  *Deposit gate*.
- No CRM-generated PDF; Zoho's template stays the source of the document.
- No re-send confirmation after an edit (explicit product decision: sync is
  enough).
- No change to who may edit: admin, or the order's consultant.

## Lifecycle

`sent_at IS NOT NULL` means "this quotation has been sent to the customer at
least once". It is set by the first **Confirm quotation sent** and never
cleared by an edit.

| Current state | Action | Result |
|---|---|---|
| `local_draft`, never sent | Save | `local_draft` (unchanged behaviour) |
| `local_draft`, never sent | Sync | `zoho_draft` (unchanged) |
| `zoho_draft`, never sent | Confirm sent | `sent`; order → `quotation_sent`; lead updated (unchanged) |
| `sent` | Save with changes | `local_draft`, `sent_at`/`sent_by`/`sent_channel` kept |
| `local_draft`/`sync_failed`, previously sent | Sync | Zoho estimate updated in place → `sent`; version snapshot written; order and lead prices refreshed |
| any, order past `quotation_sent` | Save / Sync | Refused: "This quotation is final — the deposit has been recorded" |
| `syncing` / `sending` | Save | Refused (unchanged) |

The `order_quotations_sent_complete` check only constrains rows whose status is
`sent`, so keeping the sent fields on a `local_draft` row needs no constraint
change.

**Confirm quotation sent** is shown only while `sent_at IS NULL`.
**Create revised quotation** is removed from the UI. `createQuotationRevision`
stays exported but unused until a later cleanup; existing revision rows remain
readable.

## Zoho sync of a previously-sent quotation

In `syncQuotation`:

- Accept a remote estimate whose status is `draft`, `sent`, `accepted`,
  `declined` or `expired`. Refuse `invoiced` (or any estimate with
  `invoice_ids`) with a `UserFacingError`: "This quotation has already been
  invoiced in Zoho and can no longer be changed."
- Keep the existing guards: CRM Quote Key must match, and a Zoho-side edit
  since our last sync (`last_modified_time` moved and snapshot differs) still
  goes to `conflict` with the existing **Reconcile with Zoho** action.
- Update the same `zoho_estimate_id` via `syncZohoEstimate`.
- After the update, re-read the estimate. If the quote was previously sent and
  Zoho now reports `draft` (Zoho may revert status on edit), call
  `markZohoEstimateSent` and re-read once more.
- Verify the snapshot hash and total as today. The expected post-sync status is
  `draft` for a never-sent quote and `sent` (or the pre-edit status) for a
  previously-sent one.
- Store the new PDF, `synced_payload_hash`, `zoho_last_modified_time`, and set
  status `sent` (previously sent) or `zoho_draft` (never sent).

### Version history

New append-only table `order_quotation_versions`:

| column | type |
|---|---|
| `id` | uuid pk |
| `quotation_id` | uuid fk → `order_quotations` |
| `version` | int, starts at 1 per quotation, unique with `quotation_id` |
| `lines` | jsonb (array) |
| `quoted_total_cents` | bigint |
| `pdf_storage_path` | text |
| `created_by` | uuid fk → `profiles` |
| `created_at` | timestamptz default now() |

A row is written in the same transaction that finalises a sync of a
previously-sent quotation, and by **Confirm quotation sent** for the first
send, so version 1 is always what the customer first received. The migration
backfills version 1 for every existing `sent` row from its current `lines`,
`quoted_total_cents`, `pdf_storage_path`, `sent_by` and `sent_at`. RLS policy
written as for other tables (server actions remain the access control). The
card's **Earlier versions** list reads from this table, plus any legacy
superseded revision rows.

### Downstream prices

When a previously-sent quotation re-syncs, in the same transaction:

- `orders.price_quoted_cents = quoted_total_cents`
- the linked lead's `latest_quote_cents` and `quotation_breakdown` (same
  derivation as `confirmQuotationSent`). `quotation_sent_at`, funnel stage and
  `quote_valid_days` are not touched.

## Deposit gate

`ensureZohoInvoiceForOrder` already requires `status = 'sent'` and compares the
Zoho snapshot with `synced_payload_hash`, so a quote with unsynced edits cannot
be invoiced and a re-synced one can. The message for the unsynced case becomes:
"Sync the latest quotation changes to Zoho before recording the deposit."

## Readable errors

- Every Server Action the quotation card calls returns
  `{ ok: true, ... } | { ok: false, error: string }` using
  `actionErrorMessage` from `src/lib/user-facing-error.ts`: save, sync,
  confirm sent, reconcile (both), recover stale claim, PDF URL, Zoho options /
  customer search / confirm / create customer.
- Deliberate guard messages in `src/lib/actions/quotations.ts` become
  `UserFacingError`. Database, network and Zoho internals stay generic and are
  logged server-side.
- The card's `run()` helper and PDF handlers read `result.ok` and toast
  `result.error`.

## Acceptance

1. Sent quote, order at `quotation_sent`: fields are editable; saving shows
   "Changes not synced"; **Update Zoho & refresh PDF** keeps the same QT
   number, refreshes the PDF, returns the quote to Sent, and writes version 2.
2. Order list and lead show the new total after that sync.
3. Deposit is refused while edits are unsynced, with the readable message, and
   succeeds after the sync.
4. Order at `deposit_received` or later: form is read-only; a forced save or
   sync returns "This quotation is final — the deposit has been recorded".
5. Zoho estimate edited directly in Zoho → **Needs reconciliation**, as today.
6. Zoho estimate already invoiced → readable refusal, no conflict state.
7. Any guarded failure shows its message in production instead of the digest.
8. First send still moves the order to `quotation_sent` and updates the lead.

## Verification constraints

Single production database and a live Zoho organisation (no sandbox). Unit
tests cover the lifecycle table, the Zoho status handling and the error
contract. The one live assumption — Zoho's API accepts an update to a `sent`
estimate — is verified with Jason on one real order during rollout, before
announcing the change.
