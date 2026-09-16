import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table public.manufacture_pos drop constraint if exists manufacture_pos_category_known`.execute(db);
  await sql`alter table public.manufacture_pos add constraint manufacture_pos_category_known check (category is null or category in ('day','night','blind','mesh'))`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`do $$ begin if exists (select 1 from public.manufacture_pos where category = 'mesh') then raise exception 'cannot reverse: mesh purchase orders exist'; end if; end $$`.execute(db);
  await sql`alter table public.manufacture_pos drop constraint if exists manufacture_pos_category_known`.execute(db);
  await sql`alter table public.manufacture_pos add constraint manufacture_pos_category_known check (category is null or category in ('day','night','blind'))`.execute(db);
}
