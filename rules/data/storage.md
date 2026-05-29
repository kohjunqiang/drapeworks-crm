# Supabase Storage

## Bucket convention

- One bucket per use case (e.g. `room-photos`)
- **Always private**. Public buckets are not used in this app.
- Set `file_size_limit` and `allowed_mime_types` on the bucket itself
- Re-check size + mime in the Server Action (defence in depth)

## Path convention

Paths encode ownership so RLS can parse them:

```
orders/<order_id>/rooms/<room_id>/<random-uuid>.<ext>
```

`storage.foldername(name)` returns the folders as a 1-indexed array. For the path above, `[4]` is the `room_id`.

## Upload flow (never proxy bytes through Next.js)

1. Client requests a signed upload URL via a Server Action
2. Server Action validates size + mime + role, calls `supabase.storage.from('bucket').createSignedUploadUrl(path)`, returns `{ path, token, signedUrl }`
3. Client PUTs bytes directly to `signedUrl` (or uses `uploadToSignedUrl(path, token, file)` helper)
4. Client calls a confirm action that inserts the metadata row in the DB and revalidates affected paths

This pattern keeps Next.js from holding image bytes in memory and avoids Railway's request body limits becoming a bottleneck.

## Read flow

Server Component mints signed URLs:

```ts
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';

export const signRoomPhotoUrls = cache(async (paths: string[]): Promise<Map<string, string>> => {
  if (paths.length === 0) return new Map();
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from('room-photos')
    .createSignedUrls(paths, 3600);  // 1 hour TTL
  if (error) throw new Error(error.message);
  return new Map(data.map(d => [d.path!, d.signedUrl]));
});
```

- Batch with `createSignedUrls` (plural), not `createSignedUrl` in a loop
- Wrap in React `cache()` to avoid re-signing during a single render
- TTL 1 hour — short enough to be safe, long enough to survive a page render + immediate edits

## Delete flow

Server Action removes the Storage object then the DB row:

```ts
await supabase.storage.from('room-photos').remove([photo.storage_path]);
await supabase.from('room_photos').delete().eq('id', photoId);
```

Order matters slightly — Storage first means if the DB delete fails, you have an orphan object (acceptable, can clean up later). The reverse risks the DB row pointing at a missing file.

## Storage RLS

Mirror the table policies. Parse ownership from the path:

```sql
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
```

Always test storage policies by attempting cross-user uploads in the browser DevTools — RLS errors should show up as 4xx responses, not 200s.

## Forbidden

- Public buckets
- Proxying upload bytes through Next.js Server Actions / route handlers
- Long TTL signed URLs (>1 hour) — refresh per render instead
- Putting filenames in path that contain user input without sanitising (use a UUID + extension)
- Bypassing the bucket's `allowed_mime_types` — even if the client says it's `image/jpeg`, the bucket rejects others as a backstop
