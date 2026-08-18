import { sql, type Kysely } from "kysely";

// The reason on an adjusted line becomes optional.
//
// 202608181100 added mm_override_has_reason, which refused a row marked
// is_overridden without a non-blank override_reason. That encoded a real rule
// at the time: the only way to deviate from the standard allowance was to type
// a manufacturing figure by hand, so demanding a why was cheap and bought a
// complete audit trail.
//
// The allowance is now editable per line on the reconciliation screen. Every
// manufacturing figure is therefore reachable by adjusting a delta, which means
// a required reason would be friction on one path and simply absent on the
// other — the constraint no longer buys the guarantee it was written for, it
// just makes one of two equivalent routes more annoying than the other.
//
// The reason is still captured and stored whenever it is given, and the row is
// still self-explaining without it: source + delta = mfg holds on every row, so
// what changed is always visible even when why is not.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table public.manufacture_measurements
      drop constraint mm_override_has_reason
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Blank any reason-less adjusted row back to not-adjusted first, or the
  // constraint cannot be re-added. The dimensions and deltas are untouched, so
  // no manufacturing information is lost — only the "set by hand" marking.
  await sql`
    update public.manufacture_measurements
      set is_overridden = false
    where is_overridden
      and (override_reason is null or length(trim(override_reason)) = 0)
  `.execute(db);

  await sql`
    alter table public.manufacture_measurements
      add constraint mm_override_has_reason check (
        not is_overridden
        or (override_reason is not null and length(trim(override_reason)) > 0)
      )
  `.execute(db);
}
