import { sql, type Kysely } from "kysely";

// Give the carried-over delivery address a name instead of a role.
//
// 202608211000 seeded it "Default", which was a description of what it is FOR
// and not what it IS — so the screens ended up printing "Default — Default" in
// the order's picker and "Default DEFAULT" beside its badge. The address itself
// says 广东省深圳市 (Shenzhen), which is a fact about the row rather than a name
// anybody invented, and the admin can rename it to whatever the business calls
// the place.
//
// Guarded on the old value so it cannot overwrite a name somebody has since
// typed.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    update public.delivery_vendors
      set label = 'Shenzhen warehouse'
      where label = 'Default'
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    update public.delivery_vendors
      set label = 'Default'
      where label = 'Shenzhen warehouse'
  `.execute(db);
}
