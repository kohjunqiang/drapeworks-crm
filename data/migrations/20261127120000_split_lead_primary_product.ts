import { sql, type Kysely } from "kysely";

// Split the lead primary product so new leads record a single product:
// 'Curtains' or 'Blinds' replace the combined 'Curtains / Blinds' option.
// Historical rows keep 'Curtains / Blinds' and 'Both' — nothing here rewrites
// data, and the app still accepts both legacy values on edit.
//
// Only enum additions live in this file. Postgres forbids *using* a value
// added in the same transaction, and the Kysely migrator wraps each migration
// in exactly one, so nothing else goes in here (see 202608181600).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter type public.lead_primary_product add value if not exists 'Curtains'`.execute(db);
  await sql`alter type public.lead_primary_product add value if not exists 'Blinds'`.execute(db);
}

// Postgres has no `alter type ... drop value`; reversing would mean rebuilding
// the type and rewriting every column that uses it. Raise rather than report
// success while leaving the values behind (same rationale as 202608181600).
export async function down(): Promise<void> {
  throw new Error(
    "Cannot reverse: Postgres cannot remove a value from an enum type. " +
      "'Curtains' and 'Blinds' stay in public.lead_primary_product. To truly " +
      "revert you must rebuild the type by hand, after checking no rows reference the values.",
  );
}
