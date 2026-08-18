import { sql, type Kysely } from "kysely";

// Phase 13C — where the generated 采购订单 PDFs live.
//
// A bucket in a migration, exactly like room-photos in the initial migration:
// the bucket and the policies that guard it are schema, and a bucket created by
// hand in the dashboard is one that a fresh environment silently does not have.
// The first symptom of that would be a confirm that appears to work and no
// document anywhere, since generation is deliberately non-blocking.
//
// PRIVATE, like every bucket in this app. These documents carry a customer's
// address, a vendor's contact details and the dimensions of every window in
// somebody's home; they are reached through a short-lived signed URL minted by
// a Server Action that has already checked the caller's role.

const BUCKET = "manufacture-pos";

export async function up(db: Kysely<unknown>): Promise<void> {
  // 10 MB is generous for a one- or two-page vector PDF with a subsetted font;
  // anything approaching it means something has gone wrong upstream, and the
  // bucket rejecting it is a cheaper failure than storing it. application/pdf
  // only: nothing else is ever written here.
  await sql`
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      ${BUCKET}, ${BUCKET}, false,
      ${10 * 1024 * 1024},
      array['application/pdf']
    )
    on conflict (id) do update set
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types,
      public = excluded.public
  `.execute(db);

  // Mirrors the manufacture_pos table policies (202608181500): anyone signed in
  // may read, ops and admin may write. The read is what signing a URL needs.
  //
  // The bucket id is interpolated with sql.raw rather than bound: CREATE POLICY
  // is DDL and Postgres will not accept a bind parameter in one — the error it
  // gives ("bind message supplies 1 parameters") does not mention policies at
  // all, so it is worth naming here.
  const bucket = sql.raw(`'${BUCKET}'`);
  await sql`
    create policy "manufacture_pos_storage_select_authenticated"
      on storage.objects for select to authenticated
      using (bucket_id = ${bucket})
  `.execute(db);
  await sql`
    create policy "manufacture_pos_storage_insert_ops_admin"
      on storage.objects for insert to authenticated
      with check (
        bucket_id = ${bucket}
        and (public.is_ops() or public.is_admin())
      )
  `.execute(db);
  await sql`
    create policy "manufacture_pos_storage_update_ops_admin"
      on storage.objects for update to authenticated
      using (
        bucket_id = ${bucket}
        and (public.is_ops() or public.is_admin())
      )
  `.execute(db);

  // NO DELETE POLICY, and that is the point rather than an omission — the same
  // reasoning as manufacture_pos itself. A regenerated document SUPERSEDES its
  // predecessor; the predecessor stays downloadable because a vendor may
  // already be cutting fabric from it, and "what did we actually send them"
  // cannot be answered from a row whose file has been removed.
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop policy if exists "manufacture_pos_storage_update_ops_admin" on storage.objects`.execute(
    db,
  );
  await sql`drop policy if exists "manufacture_pos_storage_insert_ops_admin" on storage.objects`.execute(
    db,
  );
  await sql`drop policy if exists "manufacture_pos_storage_select_authenticated" on storage.objects`.execute(
    db,
  );

  // Objects first: the bucket row will not drop while it still owns any. This
  // reverses a migration, so it is deleting documents on purpose — the only
  // place in this phase where that is true.
  await sql`delete from storage.objects where bucket_id = ${BUCKET}`.execute(db);
  await sql`delete from storage.buckets where id = ${BUCKET}`.execute(db);
}
