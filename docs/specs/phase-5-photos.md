# Phase 5 — Per-Room Photos via Supabase Storage

> ## Execution override (2026-05-29) — read this before the rest of the spec
>
> Phase 2 (auth) has been **deferred to the end of the milestone**. Implement this phase against the no-auth posture below. The rest of the spec was written assuming auth exists; reinterpret it through this lens:
>
> - **Drop the auth prerequisite.** Phase 1 + Phases 3-4 are the only prerequisites; `lib/auth` does not exist yet.
> - **No `requireRole` / `requireSession` in Server Actions.** Mutations run open until the auth retrofit.
> - **No role-based UI gating.** Treat every viewer as an admin.
> - **Storage bucket**: still create a **private** bucket (matches production posture), but **skip the per-user Storage RLS policies**. Generate signed upload + read URLs from the server using the **service-role** Supabase client (`SUPABASE_SERVICE_ROLE_KEY` from `.env`). The auth retrofit will swap to user-scoped policies + signed URLs minted from the user session.
> - **`uploaded_by` / `created_by` columns**: keep them as `uuid null`, no FK while there's no auth; leave null on insert.
> - **Migrations use Kysely** (`data/migrations/*.ts`); apply with `npm run db:migrate`; regenerate types with `npm run db:codegen` → `src/lib/db/schema.ts`.
> - **DB queries use Kysely** (`src/lib/db/kysely.ts`). The `@supabase/ssr` clients stay reserved for the auth retrofit; the service-role client (`src/lib/supabase/admin.ts`) is fine to use for Storage operations.
> - **Verification skips role tests.** Ignore "RLS denial", "test as consultant / ops / admin".
>
> **Execution order:** Phase 1 (done) → 3 → 4 → **Phase 5 (this)** → 6 → 7 → 2 (auth retrofit, last).

## Context for a fresh chat

Drapeworks CRM — a Next.js + Supabase app for a Singapore curtain company. A static prototype lives at `docs/prototype/` showing the target UX.

Phases 1-4 are complete: auth, fabric catalog, and the consultation form all work. Orders persist with rooms and windows. The consultation form already has a "photo placeholder" inside each room card; this phase replaces it with a real photo uploader backed by Supabase Storage. Photos are stored **per room**, not per order.

**Read these first**:
- `docs/specs/README.md` — global conventions (mandatory)
- `docs/prototype/consultation.html` — the per-room photo strip UI is inside each room card. Search for `addPhotoMock` to see the layout: 3-col on mobile, 5-col on desktop, with a "+ Add photo" tile and `×` remove buttons.
- `docs/prototype/order-detail.html` — the read-only photo strip below each room's spec table. Search for "Reference photos" inside the rooms section.
- `docs/specs/phase-4-consultation.md` — confirms what already exists

## Goal

Consultants can upload reference photos per room during consultation (and edit them later). Photos are stored in a private Supabase Storage bucket. The order detail page renders them via signed URLs. iPhone HEIC files are converted to JPEG client-side before upload.

## Prerequisites

- Phases 1-4 complete
- A Supabase project with Storage enabled (default in all new projects)
- User has at least one existing order to attach photos to
- shadcn `dialog`, `button`, `sonner` are installed (Phase 3)

## Scope (in)

- Migration creating `room_photos` table + RLS + indexes
- Migration creating the `room-photos` Supabase Storage bucket (private) + Storage RLS policies that mirror the table policies
- Client-side libraries: `heic2any` (HEIC→JPEG conversion), `browser-image-compression` (resize/compress to ~1600px and ~0.85 quality before upload)
- Server Actions: `requestRoomPhotoUpload`, `confirmRoomPhotoUpload`, `deleteRoomPhoto`
- `PhotoUploader` Client Component that:
  - Renders the existing photo strip (taking pre-signed URLs from props)
  - Has a "+ Add photo" tile that triggers a file picker
  - Optimistically shows uploading state
  - Calls request → PUT → confirm sequence
  - Calls delete on `×` click
- Replace `PhotoPlaceholder` in the consultation form with `<PhotoUploader>` per room
- Add the same photo strip (read-only, with signed URLs) to `RoomSummaryCard` on `/orders/[orderId]`
- React `cache()` wrapper for `signRoomPhotoUrls(roomId)` to avoid re-signing during render
- For the consultation form's `/orders/new` flow: photos can ONLY be attached after the order is created (we need a `room_id`). Two options:
  - **A. Two-step form**: submit order first, then redirect to `/orders/[orderId]/edit` which has the same form populated, where photos can be added
  - **B. Inline upload after first save**: after `createOrder`, store-then-attach happens via subsequent edit
  - **Recommended: option A** — `/orders/new` creates the order WITHOUT photos, redirects to `/orders/[orderId]` (read-only with photo strips visible but empty), and the user clicks "Edit" to add photos. (Edit page is built more fully in Phase 6 — this phase ships a minimal edit page that ONLY exposes photo management.)

## Out of scope

- Photo metadata editing (caption, position reordering — Phase 6 polish)
- Multiple photo upload in one drag-and-drop (single file at a time for v1 simplicity; can add later)
- Server-side image processing (thumbnails, EXIF stripping — defer)
- Storage-level virus scanning (defer)
- Photo download / print (Phase 7 if printable)

## Data model changes

```sql
-- supabase/migrations/YYYYMMDDHHMM_room_photos.sql

create table public.room_photos (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  storage_path text not null unique,
  mime_type text not null,
  size_bytes int not null,
  original_name text,
  uploaded_by uuid references public.profiles(id),
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index room_photos_room_idx on public.room_photos (room_id, position, created_at);

alter table public.room_photos enable row level security;

-- Select via order ownership chain (any authenticated can read; matches orders policy)
create policy "room_photos_select_via_order" on public.room_photos
  for select to authenticated using (
    exists (select 1 from public.rooms r where r.id = room_photos.room_id)
  );

-- Write requires order ownership or admin (same pattern as rooms/windows)
create policy "room_photos_write_owner_admin" on public.room_photos
  for all to authenticated
  using (
    exists (
      select 1 from public.rooms r
        join public.orders o on o.id = r.order_id
       where r.id = room_photos.room_id
         and (o.consultant_id = auth.uid() or public.is_admin())
    )
  )
  with check (
    exists (
      select 1 from public.rooms r
        join public.orders o on o.id = r.order_id
       where r.id = room_photos.room_id
         and (o.consultant_id = auth.uid() or public.is_admin())
    )
  );
```

```sql
-- supabase/migrations/YYYYMMDDHHMM_room_photos_storage.sql

-- Create the private bucket via SQL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'room-photos', 'room-photos', false,
  10 * 1024 * 1024,
  array['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Storage RLS: mirror room_photos policies, gated by parsing order_id and room_id from the path.
-- Path convention: orders/<order_id>/rooms/<room_id>/<filename>
-- Use storage.foldername() to extract path parts.

create policy "room_photos_storage_select_authenticated"
  on storage.objects for select to authenticated
  using (bucket_id = 'room-photos');

create policy "room_photos_storage_insert_owner_admin"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'room-photos'
    and (
      public.is_admin()
      or exists (
        select 1 from public.rooms r
          join public.orders o on o.id = r.order_id
        where r.id = ((storage.foldername(name))[4])::uuid
          and o.consultant_id = auth.uid()
      )
    )
  );

create policy "room_photos_storage_update_owner_admin"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'room-photos'
    and (
      public.is_admin()
      or exists (
        select 1 from public.rooms r
          join public.orders o on o.id = r.order_id
        where r.id = ((storage.foldername(name))[4])::uuid
          and o.consultant_id = auth.uid()
      )
    )
  );

create policy "room_photos_storage_delete_owner_admin"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'room-photos'
    and (
      public.is_admin()
      or exists (
        select 1 from public.rooms r
          join public.orders o on o.id = r.order_id
        where r.id = ((storage.foldername(name))[4])::uuid
          and o.consultant_id = auth.uid()
      )
    )
  );
```

Note on `storage.foldername()`: for the path `orders/<order_id>/rooms/<room_id>/<filename>`, the array returned by `storage.foldername(name)` is `['orders', '<order_id>', 'rooms', '<room_id>']` — i.e. index 4 (1-based) is the room_id. Verify by testing locally.

Apply migrations and regenerate types.

## Server actions added

| Action | File | Inputs | Role guard | Returns | Revalidates |
|---|---|---|---|---|---|
| `requestRoomPhotoUpload(input)` | `src/lib/actions/photos.ts` | `{ roomId: string, mime: string, sizeBytes: number, originalName: string }` | owner (consultant_id = auth.uid) or admin | `{ path, token, signedUrl }` | none |
| `confirmRoomPhotoUpload(input)` | `src/lib/actions/photos.ts` | `{ roomId, path, mime, sizeBytes, originalName }` | owner or admin | `{ photoId }` | `/orders/[orderId]`, `/orders/[orderId]/edit` |
| `deleteRoomPhoto(photoId)` | `src/lib/actions/photos.ts` | `string` | owner or admin | `void` | `/orders/[orderId]`, `/orders/[orderId]/edit` |

Sketch:

```ts
'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireSession } from '@/lib/auth/require-role';
import { createClient } from '@/lib/supabase/server';
import crypto from 'node:crypto';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const MAX_BYTES = 10 * 1024 * 1024;

async function assertCanWriteRoom(roomId: string) {
  const session = await requireSession();
  const supabase = await createClient();
  const { data: room } = await supabase
    .from('rooms')
    .select('order_id, orders!inner(consultant_id, id)')
    .eq('id', roomId)
    .single();
  if (!room) throw new Error('room not found');
  const isOwner = (room as any).orders.consultant_id === session.user.id;
  const isAdmin = session.profile.role === 'admin';
  if (!isOwner && !isAdmin) throw new Error('forbidden');
  return { session, supabase, orderId: (room as any).orders.id as string };
}

const requestSchema = z.object({
  roomId: z.string().uuid(),
  mime: z.string(),
  sizeBytes: z.number().int().positive(),
  originalName: z.string(),
});

export async function requestRoomPhotoUpload(input: unknown) {
  const parsed = requestSchema.parse(input);
  if (!ALLOWED_MIME.has(parsed.mime)) throw new Error('unsupported mime type');
  if (parsed.sizeBytes > MAX_BYTES) throw new Error('file too large');
  const { supabase, orderId } = await assertCanWriteRoom(parsed.roomId);
  const ext = parsed.mime === 'image/png' ? 'png' : parsed.mime === 'image/webp' ? 'webp' : 'jpg';
  const path = `orders/${orderId}/rooms/${parsed.roomId}/${crypto.randomUUID()}.${ext}`;
  const { data, error } = await supabase.storage
    .from('room-photos')
    .createSignedUploadUrl(path);
  if (error) throw new Error(error.message);
  return { path, token: data.token, signedUrl: data.signedUrl };
}

const confirmSchema = z.object({
  roomId: z.string().uuid(),
  path: z.string(),
  mime: z.string(),
  sizeBytes: z.number().int().positive(),
  originalName: z.string(),
});

export async function confirmRoomPhotoUpload(input: unknown) {
  const parsed = confirmSchema.parse(input);
  const { session, supabase, orderId } = await assertCanWriteRoom(parsed.roomId);
  // Server-side verification that the object exists at the path
  const { data: obj, error: headErr } = await supabase.storage
    .from('room-photos')
    .list(parsed.path.split('/').slice(0, -1).join('/'), { search: parsed.path.split('/').pop()! });
  if (headErr || !obj || obj.length === 0) throw new Error('upload not found');
  const { data, error } = await supabase
    .from('room_photos')
    .insert({
      room_id: parsed.roomId,
      storage_path: parsed.path,
      mime_type: parsed.mime,
      size_bytes: parsed.sizeBytes,
      original_name: parsed.originalName,
      uploaded_by: session.user.id,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  revalidatePath(`/orders/${orderId}`);
  revalidatePath(`/orders/${orderId}/edit`);
  return { photoId: data.id };
}

export async function deleteRoomPhoto(photoId: string) {
  const session = await requireSession();
  const supabase = await createClient();
  const { data: photo } = await supabase
    .from('room_photos')
    .select('id, storage_path, rooms!inner(order_id, orders!inner(consultant_id, id))')
    .eq('id', photoId)
    .single();
  if (!photo) throw new Error('not found');
  const orders = (photo as any).rooms.orders;
  const isOwner = orders.consultant_id === session.user.id;
  const isAdmin = session.profile.role === 'admin';
  if (!isOwner && !isAdmin) throw new Error('forbidden');
  await supabase.storage.from('room-photos').remove([photo.storage_path]);
  await supabase.from('room_photos').delete().eq('id', photoId);
  revalidatePath(`/orders/${orders.id}`);
  revalidatePath(`/orders/${orders.id}/edit`);
}
```

## Routes / pages added

| Path | File | Type |
|---|---|---|
| `/orders/[orderId]/edit` | `src/app/(app)/orders/[orderId]/edit/page.tsx` | RSC — for this phase, this page shows only the per-room photo management. Phase 6 expands it to full edit. |

Update existing pages:
- `/orders/new` — keep as-is; the form should NOT include uploader yet (photos require a room_id). On submit, redirect to `/orders/[orderId]` as before. Add a hint at the top of the order detail page: "Add reference photos by clicking Edit."
- `/orders/[orderId]` — add the read-only photo strips inside each `RoomSummaryCard`, fed by signed URLs.

## Components added

| Component | File | Type | Responsibility |
|---|---|---|---|
| `PhotoUploader` | `src/components/orders/photo-uploader.tsx` | Client | Renders strip with "+ Add" tile. Handles HEIC→JPEG, compression, request/PUT/confirm, optimistic UI, error toasts. |
| `PhotoStrip` | `src/components/orders/photo-strip.tsx` | RSC | Read-only display of photos from signed URLs (used on order detail) |
| `RoomEditCard` | `src/components/orders/room-edit-card.tsx` | Client | For Phase 5's minimal edit page: shows room header + nested `<PhotoUploader>` only |

Update existing:
- `src/components/orders/consultation-form/photo-placeholder.tsx` — keep as-is on `/orders/new` (form is one-shot create; uploader appears only on edit page after order has IDs)
- `src/components/orders/room-summary-card.tsx` — append `<PhotoStrip photos={...} />` below the windows table

Helper:

| File | Contents |
|---|---|
| `src/lib/db/photos.ts` | `signRoomPhotoUrls(roomIds: string[])` — cached via React `cache()`; returns map of `photoId → signedUrl`. Use `createSignedUrls` (plural) for batch efficiency. TTL 3600s. |

`PhotoUploader` flow:

```ts
// Pseudo
async function handleFileSelect(file: File) {
  setUploading(true);
  let toUpload = file;
  if (file.type === 'image/heic' || file.name.toLowerCase().endsWith('.heic')) {
    const heic2any = (await import('heic2any')).default;
    const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.85 });
    toUpload = new File([converted as Blob], file.name.replace(/\.heic$/i, '.jpg'), { type: 'image/jpeg' });
  }
  const imageCompression = (await import('browser-image-compression')).default;
  toUpload = await imageCompression(toUpload, { maxSizeMB: 2, maxWidthOrHeight: 1600, useWebWorker: true });

  const { path, signedUrl, token } = await requestRoomPhotoUpload({
    roomId, mime: toUpload.type, sizeBytes: toUpload.size, originalName: file.name,
  });
  const putRes = await fetch(signedUrl, { method: 'PUT', headers: { 'Content-Type': toUpload.type, 'x-upsert': 'false' }, body: toUpload });
  if (!putRes.ok) throw new Error('upload failed');
  await confirmRoomPhotoUpload({ roomId, path, mime: toUpload.type, sizeBytes: toUpload.size, originalName: file.name });
  toast.success('Photo uploaded');
  router.refresh();
  setUploading(false);
}
```

(Note: the exact signed upload PUT shape depends on the Supabase Storage version; check the @supabase/supabase-js docs for `uploadToSignedUrl` if `createSignedUploadUrl` returns a token rather than a direct URL — `supabase.storage.from('room-photos').uploadToSignedUrl(path, token, file)` is the supported helper.)

## UI references

- `docs/prototype/consultation.html` — search for "Per-room photos" / `addPhotoMock` to find the strip layout:
  - `grid grid-cols-3 sm:grid-cols-5 gap-2`
  - Each tile: `aspect-square bg-slate-100 rounded border border-slate-200`
  - Remove button: `absolute top-1 right-1 w-5 h-5 rounded-full bg-white/90`
  - "+ Add photo" tile: dashed border, hover: `border-teal-500 text-teal-600`
- `docs/prototype/order-detail.html` — search for "Reference photos" inside each room block:
  - `grid grid-cols-4 sm:grid-cols-6 gap-2`
  - Each tile: `aspect-square bg-gradient-to-br ... rounded`
  - Below the windows table, separated by `border-t border-slate-100`

## Implementation tasks

1. **Install client libraries**:
   ```bash
   npm install heic2any browser-image-compression
   npm install -D @types/heic2any  # if types missing — heic2any may not have official types; declare in src/types/heic2any.d.ts if needed
   ```

2. **Write the two migrations** (table + storage bucket/policies), apply with `supabase db push`, regenerate types.

3. **Verify the bucket exists** in the Supabase dashboard → Storage → `room-photos` is private with the right size limit and MIME types.

4. **Create the Server Actions** at `src/lib/actions/photos.ts` (sketch above). Test each from a server console / quick test page.

5. **Create the signed-URL helper** `src/lib/db/photos.ts`:
   ```ts
   import { cache } from 'react';
   import { createClient } from '@/lib/supabase/server';

   export const signRoomPhotoUrls = cache(async (paths: string[]): Promise<Map<string, string>> => {
     if (paths.length === 0) return new Map();
     const supabase = await createClient();
     const { data, error } = await supabase.storage
       .from('room-photos')
       .createSignedUrls(paths, 3600);
     if (error) throw new Error(error.message);
     return new Map(data.map(d => [d.path!, d.signedUrl]));
   });
   ```

6. **Create `PhotoStrip`** (RSC) for the read-only display on order detail.

7. **Create `PhotoUploader`** (Client) for the edit page:
   - Props: `roomId: string`, `photos: { id: string; signedUrl: string; originalName: string }[]`
   - Render existing photos with `×` remove (calls `deleteRoomPhoto`)
   - Render `+` tile that opens file picker
   - Use the flow sketch above for upload
   - Use `useTransition` + `useOptimistic` for snappy UI

8. **Build the minimal `/orders/[orderId]/edit` page**:
   - Auth-protected; only owner or admin
   - Fetch order with rooms + photos (with signed URLs)
   - Render header "Editing DW-YYYY-NNNN" + "Back to order" link
   - Render one `RoomEditCard` per room — each card shows room name + label and a `PhotoUploader`
   - **Note**: full consultation field editing is added in Phase 6. For now, the page is purely a photo-management screen.

9. **Update `/orders/[orderId]`** (read-only view):
   - Mint signed URLs server-side (one call: `signRoomPhotoUrls(allPaths)`)
   - Pass per-room photo lists down to each `RoomSummaryCard`
   - Render `<PhotoStrip>` below each windows table
   - Add a button at the top: "Edit photos" → links to `/orders/[orderId]/edit`

10. **Test the upload flow** on desktop and mobile:
    - Desktop: pick a regular JPEG → uploads → appears in strip
    - Desktop: pick a HEIC file (download a sample from `https://github.com/strukturag/libheif/raw/master/examples/example.heic` or use any iPhone-exported HEIC) → converts → uploads as JPEG
    - Mobile Safari (real iPhone if possible): pick from camera roll → photos converted and uploaded
    - File too large: shows error toast
    - Wrong mime: shows error toast
    - Delete a photo: removes from strip and from Storage (verify in Supabase dashboard)

11. **RLS verification**:
    - As consultant A, upload a photo to your own order → success
    - As consultant B (different user), try to call `requestRoomPhotoUpload` for consultant A's room → expect `forbidden`
    - As consultant B, try direct Storage upload to consultant A's path via browser console → expect RLS denial
    - As admin, can upload/delete on any room

12. **Mobile QA**: photo strip stays clean at 375px (3-col), tap targets are at least 44px high.

13. **Commit and deploy**:
    ```bash
    git add . && git commit -m "feat(photos): per-room photo upload via Supabase Storage"
    git push
    ```

## Verification

- [ ] `room-photos` bucket exists, private, with size + MIME restrictions
- [ ] Storage policies enforce per-order ownership on insert/update/delete
- [ ] `room_photos` table RLS matches Storage RLS (owner or admin write, all authenticated read)
- [ ] Uploading a JPEG works end-to-end; row in `room_photos` + object in Storage
- [ ] Uploading a HEIC works (converted to JPEG client-side)
- [ ] Files >10MB rejected before upload
- [ ] Non-image mime types rejected
- [ ] Other consultants cannot upload to or delete from someone else's order's photos
- [ ] Admin can manage any room's photos
- [ ] `/orders/[orderId]` shows photos correctly via signed URLs
- [ ] `/orders/[orderId]/edit` only owner/admin can access
- [ ] Deleted photos disappear from both DB and Storage
- [ ] Toast notifications appear on success and error

## Hand-off to next phase

After Phase 5, the next phase (Phase 6 — Orders Dashboard + Status Workflow) can assume:

- Photos are fully working per-room
- `signRoomPhotoUrls(paths)` helper exists for any page that needs to render photos
- A minimal `/orders/[orderId]/edit` page exists — Phase 6 expands it to full consultation-form editing while preserving the photo-management section
- `room-photos` Storage bucket and policies exist and won't change
- `PhotoUploader` and `PhotoStrip` are reusable components
