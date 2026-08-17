import { type Kysely } from "kysely";

// Phase 13A — install_width_cm never had a defined meaning.
//
// It originates in commit 9a97d0a as `win.installWidth`, an Alpine.js model in
// docs/prototype/consultation.html, and was copied into phase-4-consultation.md
// as a bare column. No spec, rule file or comment anywhere says what it
// measures. No pricing, COGS, quote or staleness code ever read it: its whole
// lifecycle was form -> store -> one display column.
//
// Its eight live values were 8 and 10, against windows 250-300cm wide. Those
// are not widths. Leaving an undefined field next to the Phase 13B
// manufacturing measurements is an invitation to mis-enter data.
//
// The values are not recoverable and are not worth recovering; down() restores
// the column shape only.

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("windows").dropColumn("install_width_cm").execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("windows")
    .addColumn("install_width_cm", "integer")
    .execute();
}
