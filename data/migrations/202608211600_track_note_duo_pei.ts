import { sql, type Kysely } from "kysely";

// 多陪 → 多配 in the rail order's standing instructions.
//
// 202608210900 seeded 多陪连接器和滑轨 and argued it was not ours to correct —
// the same rule that keeps catalogue labels verbatim. That rule was right and
// the conclusion was wrong: 多陪 was a transcription slip on OUR side, not the
// supplier's wording. Asked directly, the business says 多配 (send spare) is
// what it has always meant.
//
// Guarded on the exact seeded string so an admin who has since rewritten the
// note keeps their version — this corrects our typo, it does not impose a
// house style on a field whose whole point is that they own it.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    update public.procurement_settings
      set track_note_cn = '多配连接器和滑轨' || chr(10) || '加固包装'
      where singleton = true
        and track_note_cn = '多陪连接器和滑轨' || chr(10) || '加固包装'
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    update public.procurement_settings
      set track_note_cn = '多陪连接器和滑轨' || chr(10) || '加固包装'
      where singleton = true
        and track_note_cn = '多配连接器和滑轨' || chr(10) || '加固包装'
  `.execute(db);
}
