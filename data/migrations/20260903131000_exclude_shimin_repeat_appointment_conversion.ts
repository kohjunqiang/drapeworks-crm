import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // Stage history must remain intact, but Analytics needs to distinguish a
  // lead's first appointment conversion from a later repeat site visit.
  await db.schema
    .alterTable("lead_stage_events")
    .addColumn("counts_as_appointment_conversion", "boolean", column =>
      column.notNull().defaultTo(true),
    )
    .execute();

  await sql`
    do $$
    begin
      if not exists (
        select 1
          from public.lead_stage_events e
          join public.leads l on l.id = e.lead_id
         where e.id = '27d5fcf0-2fd8-475c-ad89-8510f871bdcc'::uuid
           and e.lead_id = 'fd4a5815-f40a-43ed-a1b6-1d1fe393b3b0'::uuid
           and l.name = 'shimin'
           and l.lead_ref = 'TG-137359731'
           and e.from_stage = 'Book Appointment'
           and e.to_stage = 'Attend Appointment'
           and e.changed_at = '2026-09-03T05:00:17.488Z'::timestamptz
      ) then
        raise exception 'Expected Shimin repeat-appointment event was not found';
      end if;

      update public.lead_stage_events
         set counts_as_appointment_conversion = false
       where id = '27d5fcf0-2fd8-475c-ad89-8510f871bdcc'::uuid;
    end
    $$
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("lead_stage_events")
    .dropColumn("counts_as_appointment_conversion")
    .execute();
}
