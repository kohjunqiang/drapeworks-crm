import { sql, type Kysely } from "kysely";

// Phase 13C — the Blinds sample PO has a row for a room type we do not have:
//
//     SR Service Yard | 卷帘 | 1079-13 | 2.46 | 2.05 | 1.20 | 要罩盒 - with cover
//
// A service yard is a standard HDB feature, so this is a real gap in the enum
// rather than a one-off, and a window in one cannot currently be recorded at
// all.
//
// THIS MIGRATION CONTAINS ONE STATEMENT AND MUST STAY THAT WAY.
//
// Postgres forbids *using* an enum value in the same transaction that adds it,
// and the Kysely migrator wraps each migration in exactly one transaction.
// 202608181700_seed_procurement.ts inserts a room_type_labels row keyed on
// 'Service Yard', which is a use. Merging these two files would fail at
// runtime with "unsafe use of new value of enum type". Phase 13A hit this
// exact trap — see the header of 20260817150000_order_flow_statuses.ts, which
// adds enum values and pointedly does nothing else with them.
//
// So: nothing else goes in here. Not the seed, not a backfill, not a check
// constraint mentioning the value.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter type public.room_type add value 'Service Yard'`.execute(db);
}

// Postgres has no `alter type ... drop value`. Reversing would mean rebuilding
// the type and rewriting every column that uses it, which fails outright
// against any row already sitting on the new value.
//
// This raises rather than returning quietly. A silent no-op down() would let a
// `db:migrate:down` report success while leaving the type changed, and the next
// `up` would then fail on a duplicate value with a confusing error a long way
// from its cause. Better to say so here.
export async function down(): Promise<void> {
  throw new Error(
    "Cannot reverse: Postgres cannot remove a value from an enum type. " +
      "'Service Yard' stays in public.room_type. To truly revert you must " +
      "rebuild the type by hand, after checking no rows reference the value.",
  );
}
