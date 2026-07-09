# Phase 8 — Curtain Type Catalog (photo-backed, Day/Night)

> **Status: DRAFT PLAN** — written 2026-07-07. One design decision is still open (see
> **§0 Open decision** below). Everything else is specified end-to-end. Resolve §0 before executing.

## Context for a fresh chat

Drapeworks CRM — Next.js 15 App Router + Supabase (Postgres/Auth/Storage/RLS) + Kysely, for a
Singapore curtain company. v1 is shipped: fabrics catalog, consultation form, orders, photos, and
**auth is retrofitted** (Server Actions now start with `requireRole([...])` / `requireSession()`,
RLS is live on every table).

**Read these first**
- `docs/specs/README.md` — global conventions (mandatory)
- `rules/data/migrations.md`, `rules/data/rls.md`, `rules/data/storage.md` — migration/RLS/storage rules
- `rules/code/server-actions.md`, `rules/code/forms.md` — action + form patterns
- Reference implementations to **clone**:
  - Catalog CRUD pattern → `src/lib/actions/fabrics.ts`, `src/lib/validation/fabric.ts`,
    `src/components/fabrics/*`, `src/app/(app)/fabrics/page.tsx`
  - Storage upload pattern → `src/lib/actions/photos.ts` (`room-photos` bucket, signed-upload-URL flow)

## Goal

Give **admins** a managed **curtain-type catalog** — each entry has a **label**, a **category
(`Day` or `Night`)**, and an **uploaded photo** — and surface it in the consultation form so
consultants pick a curtain type from a **photo-enabled dropdown** instead of typing/guessing.

This mirrors the existing **fabrics** feature (text/CRUD/admin/RLS) but adds **real image upload**
(fabrics only have a hex swatch — this needs the room-photos Storage pattern instead).

---

## §0 Open decision — how curtain-type relates to fabric selection

Today the consultation form's curtain pickers are **fabric-code dropdowns** (`window-fields.tsx`):
regular windows have Day-curtain + Night-curtain `<select>`s over `fabrics` (filtered by
`fabric_type`), toilet windows have a single fabric `<select>`. Curtain codes are stored on
`windows.day_curtain_code` / `night_curtain_code` / `curtain_code` (FK → `fabrics.code`).

The new catalog is conceptually the **same Day/Night curtain choice**, just photo-backed. Two ways
to wire it:

- **(A) Replace the fabric day/night pickers with curtain-type pickers** *(recommended)*. The form's
  Day/Night dropdowns select curtain **types** (with photos); we store new
  `day_curtain_type_id` / `night_curtain_type_id` / `curtain_type_id` FKs on `windows`. Keep the old
  fabric-code columns in the DB (non-destructive; existing orders unaffected) but stop writing them
  from the form. Cleaner UX, matches "curtain type = the day/night selection".
- **(B) Add curtain-type as a second picker alongside the existing fabric selection**. Each window
  then carries both a fabric code (material) and a curtain type. More data captured, but two
  parallel Day/Night dropdowns is confusing UX.

**This spec is written for (A).** If (B) is chosen, the only deltas are: keep the fabric `<select>`s
in `window-fields.tsx`, and don't stop writing the fabric-code fields. The DB migration is additive
either way.

---

## Scope (in)

- Migration: `curtain_category` enum (`Day`,`Night`), `curtain_type_status` enum
  (`Active`,`Archived`), `curtain_types` table + RLS + `updated_at` trigger, private Storage bucket
  `curtain-type-photos`, and **additive** `*_curtain_type_id` FK columns on `windows`.
- `src/lib/validation/curtain-type.ts` — Zod schema.
- `src/lib/actions/curtain-types.ts` — `upsertCurtainType`, `toggleCurtainTypeStatus`,
  `requestCurtainTypePhotoUpload`, `confirmCurtainTypePhotoUpload` (+ orphan cleanup).
- Admin UI: `/admin/digital-catalogue` page (or a tab under an existing admin area) with a client
  table + add/edit dialog (label, category, photo upload).
- Consultation form: photo-enabled Day/Night curtain-type dropdown per window (see §0 A).
- Order create/edit persistence of the new FK(s).
- Order detail view: show curtain type label + thumbnail.
- `npm run db:codegen` after the migration.

## Out of scope

- Migrating/backfilling existing orders' fabric codes into curtain types.
- Multiple photos per curtain type (single hero photo for v1).
- Consultant/ops ability to create curtain types (admin-only, like fabrics).
- A full visual grid picker (v1 is a dropdown that shows a small thumbnail per option).

---

## Data model changes

New migration `data/migrations/YYYYMMDDHHMM_curtain_types.ts` (Kysely, UTC timestamp). Mirror the
fabrics table (`data/migrations/20260530065634_initial.ts:169-235`) and its RLS.

```ts
// up(db)
await sql`create type public.curtain_category as enum ('Day', 'Night')`.execute(db);
await sql`create type public.curtain_type_status as enum ('Active', 'Archived')`.execute(db);

await db.schema
  .createTable("curtain_types")
  .addColumn("id", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
  .addColumn("label", "text", (c) => c.notNull())
  .addColumn("category", sql`public.curtain_category`, (c) => c.notNull())
  // single hero photo — store the Storage object path, sign a read URL per render.
  .addColumn("photo_path", "text")                       // nullable: allow save-before-upload
  .addColumn("photo_mime", "text")
  .addColumn("status", sql`public.curtain_type_status`, (c) =>
    c.notNull().defaultTo(sql`'Active'::public.curtain_type_status`))
  .addColumn("created_by", "uuid", (c) => c.references("profiles.id"))
  .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
  .addColumn("updated_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
  .execute();

// updated_at trigger — reuse the shared set_updated_at fn if one exists (fabrics uses one),
// otherwise create curtain_types_set_updated_at like fabrics_set_updated_at.

// indexes
await db.schema.createIndex("curtain_types_status_idx").on("curtain_types").column("status").execute();
await db.schema.createIndex("curtain_types_category_idx").on("curtain_types").column("category").execute();

// RLS — mirror fabrics: authenticated read, admin write, no delete policy (soft-delete via status).
await sql`alter table public.curtain_types enable row level security`.execute(db);
await sql`create policy curtain_types_select_authenticated on public.curtain_types
          for select to authenticated using (true)`.execute(db);
await sql`create policy curtain_types_insert_admin on public.curtain_types
          for insert to authenticated with check (public.is_admin())`.execute(db);
await sql`create policy curtain_types_update_admin on public.curtain_types
          for update to authenticated using (public.is_admin()) with check (public.is_admin())`.execute(db);

// windows: additive nullable FKs (see §0). Non-destructive — old fabric-code columns stay.
await db.schema.alterTable("windows")
  .addColumn("day_curtain_type_id",  "uuid", (c) => c.references("curtain_types.id"))
  .addColumn("night_curtain_type_id","uuid", (c) => c.references("curtain_types.id"))
  .addColumn("curtain_type_id",      "uuid", (c) => c.references("curtain_types.id")) // toilet variant
  .execute();
```

`down(db)`: drop the three window columns, drop `curtain_types` (+ its trigger/indexes), drop the two
enums. Reverse order.

**Storage bucket** (`curtain-type-photos`) — private, per `rules/data/storage.md`. Create it the same
way room-photos is created (via Supabase dashboard/CLI or a bucket-provisioning step used in Phase 5),
with `file_size_limit` and `allowed_mime_types` set on the bucket. Path convention:
`curtain-types/<curtain_type_id>/<random-uuid>.<ext>`. Storage RLS: authenticated read; writes only
via the service-role `adminClient()` in the confirm/upload action (same as room-photos).

After migrating: **`npm run db:codegen`** → regenerates `src/lib/db/schema.ts` (adds `CurtainTypes`
interface + the new window columns + registers the table on `DB`).

---

## Validation — `src/lib/validation/curtain-type.ts`

Mirror `fabric.ts`. Shared client+server.

```ts
export const CURTAIN_CATEGORIES = ["Day", "Night"] as const;

export const curtainTypeSchema = z.object({
  isNew: z.boolean(),
  id: z.string().uuid().optional(),               // present on edit
  label: z.string().min(1).max(120),
  category: z.enum(CURTAIN_CATEGORIES),
  // photo is uploaded via a separate action; the form submits an already-uploaded path (or none).
  photo_path: z.string().optional(),
  photo_mime: z.string().optional(),
});
```

Photo upload request/confirm get their own tiny schemas (mime + size), copied from `photos.ts`.

---

## Server Actions — `src/lib/actions/curtain-types.ts`

`"use server"` + `import "server-only"`. Clone `fabrics.ts` (CRUD) and `photos.ts` (upload).

- `upsertCurtainType(input)` — `await requireRole(["admin"])`; `curtainTypeSchema.parse(input)`;
  insert when `isNew`, else `updateTable("curtain_types").set({...}).where("id","=",id)`;
  stamp `created_by` from `session.user.id` on insert; `revalidatePath("/admin/digital-catalogue")`
  and `revalidatePath("/orders/new")`.
- `toggleCurtainTypeStatus(id)` — admin-only; flip `Active`⇄`Archived` (soft delete — **no hard
  deletes**).
- `requestCurtainTypePhotoUpload({ curtainTypeId, mime, size })` — admin; validate mime/size against
  bucket limits; build path `curtain-types/<id>/<uuid>.<ext>`;
  `adminClient().storage.from("curtain-type-photos").createSignedUploadUrl(path)`; return
  `{ path, token, signedUrl }`. Client PUTs bytes directly (never proxy through Next.js).
- `confirmCurtainTypePhotoUpload({ curtainTypeId, path, mime })` — admin; verify path prefix matches
  the id; `list` the object to confirm it exists; update the row's `photo_path`/`photo_mime`;
  `revalidatePath`. (Single hero photo lives directly on the row — no separate metadata table.)
- `cleanupOrphanCurtainTypePhoto(path)` — best-effort remove on aborted upload (copy from photos.ts).

**Reading photos**: a `signCurtainTypePhotoUrls(paths)` helper wrapped in React `cache()`, using
`createSignedUrls` (batched, TTL ≤ 1 hour) — same shape as `signRoomPhotoUrls` in `storage.md`.

---

## Admin UI — `/admin/digital-catalogue`

The **route** is `/admin/digital-catalogue` (that's what admins call it). The **feature/component
folder** stays `curtain-types` (the underlying data concept). Clone the fabrics page + dialog.

- `src/app/(app)/admin/digital-catalogue/page.tsx` — Server Component, `requireRole(["admin"])` (this
  is an admin-only management screen; fabrics is authenticated-view + admin-edit, but curtain-type
  management can be admin-only). Load all curtain types via Kysely, sign photo URLs, pass rows +
  `isAdmin` to a client table. Add a nav link labelled "Digital Catalogue" in the admin area /
  `src/components/nav/`, pointing at `/admin/digital-catalogue`.
- `src/components/curtain-types/curtain-types-table.tsx` — client; search + category/status filter;
  desktop table + mobile cards; thumbnail per row; Add / Edit / Archive-Reactivate actions.
- `src/components/curtain-types/curtain-type-form-dialog.tsx` — RHF + `zodResolver(curtainTypeSchema)`;
  fields **label**, **category** (`Day`/`Night` select), **photo** (file input → client-side
  HEIC→JPEG + compression like room photos, then request-signed-URL → PUT → confirm). On submit call
  `upsertCurtainType` in `useTransition`, toast success/error. (Unlike fabrics there's no immutable
  code field, so nothing to disable on edit.)

Reuse the room-photo client upload helpers (`heic2any` + `browser-image-compression`) referenced in
`README.md` Photos row and Phase 5.

---

## Consultation form integration

Per §0 (A):

1. **Load** active curtain types server-side where fabrics are currently loaded
   (`src/app/(app)/orders/new/page.tsx` and the edit page). Select `id, label, category, photo_path`,
   `where status = 'Active'`, order by `category, label`. Sign the photo URLs. Pass down
   `ConsultationForm → room-card → WindowFields` alongside (or instead of) `fabrics`.
2. **Swap the pickers** in `src/components/orders/consultation-form/window-fields.tsx`:
   - Regular window: replace the Day-curtain and Night-curtain fabric `<select>`s with curtain-type
     `<select>`s filtered by `category === "Day"` / `"Night"`, binding
     `${base}.day_curtain_type_id` / `${base}.night_curtain_type_id`. Keep the `draw` select as-is.
   - Toilet window: replace the single fabric select with a curtain-type select (all categories, or
     default Day) binding `${base}.curtain_type_id`.
   - Show a small thumbnail next to the selected option (native `<select>` can't render images, so
     render a preview `<img>` beside the control driven by the chosen id, or use a shadcn
     Combobox/Popover for an inline thumbnail list — v1 acceptable: plain `<select>` + preview img).
3. **Zod** (`src/lib/validation/order.ts`): add optional `day_curtain_type_id`/`night_curtain_type_id`
   to `regularWindow`, `curtain_type_id` to `toiletWindow` (and the `draft`/`edit` variants). Keep the
   old `*_curtain_code` fields present-but-unused for now (or drop from the schema under option A —
   but leave the DB columns).
4. **Persist**: update the order create/edit path (the `create_order` RPC / order actions and the
   `windows` insert) to write the new `*_curtain_type_id` columns. If creation goes through a Postgres
   RPC (`public.create_order(jsonb)`), extend the RPC to read the new keys from the JSON and insert
   them; otherwise update the Kysely insert. **Check whether `validate_window_shape()` needs updating**
   so toilet windows only set `curtain_type_id` and regular windows only set day/night — mirror the
   existing shape guard.

## Order detail view

Where curtain codes are currently displayed on `/orders/[orderId]`, resolve and show the curtain
**type** (label + small thumbnail) via a join to `curtain_types` and `signCurtainTypePhotoUrls`.

---

## Task order (execution checklist)

1. Write + run the migration (`db:migrate`), then `db:codegen`. Create the Storage bucket with
   size/mime limits.
2. `curtain-type.ts` validation + `curtain-types.ts` actions (CRUD + photo upload/confirm) + the
   `signCurtainTypePhotoUrls` read helper.
3. Admin page + table + dialog; verify create/edit/archive + photo upload end-to-end.
4. Wire the consultation form (load, swap pickers, extend Zod, persist FKs, update shape trigger if
   needed).
5. Order detail display.
6. Verification (below). Commit per logical unit (`db:`, `feat:`).

## Verification

- Migration applies and reverts cleanly; `schema.ts` regenerated with `CurtainTypes` + new window
  columns.
- As **admin**: create a Day type + a Night type, each with an uploaded photo; edit a label; archive
  one and confirm it disappears from the consultation dropdown (only `Active` shown).
- As **non-admin** (consultant): `/admin/digital-catalogue` is 404 (`requireRole` → `notFound()`) and the
  `upsertCurtainType` action rejects — confirm RLS `is_admin()` denies the insert too.
- New consultation → pick Day + Night curtain types → save → reopen: selections persist; order detail
  shows label + thumbnail.
- Photo bytes go **direct to Storage** (check network: PUT to the signed URL, not through Next.js);
  read URLs are signed and expire ≤ 1h.
- `npm run build` (type check) + `npm run lint` clean.

## Rules to respect (don't skip)

- Every Server Action starts with `requireRole(["admin"])` / `requireSession()` **and** Zod-validates
  input. RLS `is_admin()` is the real guard; the action check is defence-in-depth.
- **No hard deletes** — archive via status.
- Storage: private bucket, size+mime limits on bucket *and* re-checked in the action, UUID paths (never
  raw filenames), signed read URLs TTL ≤ 1h, never proxy bytes through Next.js.
- Mirror the prototype's form layout/classes; only diverge for the new photo-picker with explicit
  reason (note it — the prototype/`docs/prototype/consultation.html` should be updated to match).
- After the migration, `npm run db:codegen`.
