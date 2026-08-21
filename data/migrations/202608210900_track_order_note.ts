import { sql, type Kysely } from "kysely";

// The standing instructions at the foot of a rail order.
//
// The order itself is derived — one line per window, from the measured widths —
// but it ends with two sentences that are the same every time and are the
// business's own words:
//
//   多陪连接器和滑轨      (send spare connectors and slide rails)
//   加固包装              (reinforce the packaging)
//
// Stored rather than written into the code so they can be changed without a
// deploy, and transcribed VERBATIM: 多陪 is very likely 多配 mistyped, and it
// is not ours to correct — the supplier has been reading it this way for years.
// Same rule as catalogue labels (rules/code/forms.md).
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("procurement_settings")
    .addColumn("track_note_cn", "text")
    .execute();

  await sql`
    update public.procurement_settings
      set track_note_cn = '多陪连接器和滑轨' || chr(10) || '加固包装'
      where singleton = true
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("procurement_settings")
    .dropColumn("track_note_cn")
    .execute();
}
