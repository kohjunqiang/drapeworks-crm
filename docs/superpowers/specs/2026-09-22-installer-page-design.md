# Installer page — design

Date: 2026-09-22 · Status: approved by Jason in chat, local build only (no push until Jason verifies)

## Problem

Ops hands an installation to the installer by pressing **Copy details** on the order's
Installation schedule card and pasting the text into WhatsApp. The text carries the
schedule, customer and per-window measurements, but not the site photos, and the
installer has no login to the CRM. The installer needs one link that shows the
measurement notes and the room photos on their phone.

## Decisions (agreed with Jason)

| Question | Decision |
|---|---|
| Link lifetime | Works from booking until **14 days after the order is Completed**. Dead immediately when the installation is cancelled. Ops/admin can reset it. |
| Customer info | Same as the copied text: date/time, address, customer name, mobile. |
| Photos | Consultation room photos, per room. View only. No installer upload. |
| UI | **No new components.** Reuse the order page's `RoomSummaryCard` / `MeshRoomSummaryCard` (which already include `PhotoStrip`). The page header is plain page markup using the order page's section classes. |
| Approach | Stored random token on the booking (not a stateless signed URL — that cannot be revoked per link and cannot know the completion date at copy time). |

## Behaviour

### Token lifecycle

- `fulfilment_arrangements.installer_token uuid not null unique default gen_random_uuid()`.
  The default backfills every existing booking.
- **Reschedule** (booking not cancelled) keeps the token — the link already sent keeps working.
- **Re-book after a cancel** issues a new token — an old link must not come back to life.
- **Reset link** (ops/admin) issues a new token on an active booking. The old link stops working at once.

### When a link is active

A pure function decides, given the arrangement, the order's current status and when
the order entered Completed:

1. No arrangement with that token → inactive.
2. `cancelled_at` set → inactive.
3. Order status is `completed`: active only while `now < the time the order entered
   Completed + 14 days`. Completed with no `completed` event on record → inactive.
   "Entered Completed" is the earliest `completed` event after the most recent
   non-`completed` event — notes added to a completed order are stamped `completed`
   too and must not restart the window, while an admin revert followed by
   re-completion does.
4. Otherwise → active.

Every inactive case renders the same neutral page ("This link is no longer active.
Please contact Drapeworks.") with HTTP 404, so the page never reveals which case applied.
A malformed token (not a UUID) is inactive without a database query.

### Public page `/install/<token>`

Route lives at `src/app/install/[token]/`, outside the `(app)` group, so there is no
login and no nav. Server component, rendered per request.

- Metadata: `robots: noindex, nofollow`; `referrer: no-referrer` so the token is not
  sent in the Referer header when photos load from Supabase Storage.
- Middleware matcher skips `install/` (no Supabase session refresh for public visitors).
- **Header section:** order reference (`primaryOrderIdentifier`), installation date and
  time in Singapore time with duration, address (link to Google Maps search), customer
  name, mobile (`tel:` link).
- **Rooms & measurements (cm) section:** identical to the order page's section — same
  heading, same "Measured is the original site measurement…" note when installation sizes
  exist, same `RoomSummaryCard` / `MeshRoomSummaryCard` with the same data, each with its
  room photos. `orderControls` omitted.
- **Not shown:** prices, payment, quotation, status timeline, general notes, consultant,
  customer email, completion photos, delivery numbers, any action.
- Photo URLs are signed for 1 hour at render (existing `signRoomPhotoUrls`); reloading
  re-signs.

### Shared data loader

The rooms/windows/panels/photos assembly currently inline in
`src/app/(app)/orders/[orderId]/page.tsx` moves into a server-only loader. The order page
and the public page both call it, so the installer sees exactly what the order page shows.
The order page must render the same output as before; its other consumers of that data
(fabric-selection notes, mesh area breakdown) keep receiving the same values.

### Copy details

- `buildInstallationSummary` takes an optional installer page URL and appends a final
  block `Photos & measurements: <url>`. Without a URL, output is byte-for-byte unchanged.
- URL = `NEXT_PUBLIC_SITE_URL` + `/install/<token>`. If `NEXT_PUBLIC_SITE_URL` is unset,
  no URL line (never a relative or broken link).
- The Google Calendar event description is **unchanged** (it keeps its current text and
  internal order link). A reset would otherwise leave a stale link in the calendar until
  the next sync. Possible follow-up.

### Installation schedule card

Existing `FulfilmentArrangementCard`, active booking only:

- **Open installer page** link next to Copy details (new tab, `noopener noreferrer`).
- **Reset link** for ops/admin, behind the card's existing Dialog confirm pattern:
  "The old link stops working. Copy the details again and resend them to the installer."
  On success: toast and `router.refresh()` so the preview and Copy text carry the new URL.

### Server action

`resetInstallerLink({ order_id })` in `src/lib/actions/fulfilment.ts`:
`requireRole(["ops", "admin"])`, Zod-validated, updates the token only on a non-cancelled
arrangement (error "No active installation booking" otherwise), revalidates the order path.

## Security notes

- The page is the one deliberate exception to "every page requires a session". Its only
  access check is the token plus the active rule above. It exposes no mutation.
- Queries select explicit columns only. The token is a v4 UUID (122 random bits).
- No logging of tokens.

## Testing

- Unit: active rule (active, cancelled, completed 13 days ago, 15 days ago, exactly 14
  days, completed without an event); summary with and without URL; reset action rejects
  consultant, rotates token, errors with no active booking; save rotates the token on
  re-book after cancel and keeps it on reschedule.
- Local runtime: logged-out fetch of an active link, unknown UUID and malformed token;
  375px layout; order page Rooms & measurements renders as before; Copy details text ends
  with the URL.

## Rollout

One additive migration (safe for the currently deployed code). The only database is
production, so the migration is applied only with Jason's explicit go-ahead. Nothing is
pushed until Jason has verified locally.
