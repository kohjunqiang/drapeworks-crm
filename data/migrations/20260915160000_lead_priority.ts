import { sql, type Kysely } from "kysely";

// Frozen scoring policy. Generated columns cover every writer, including quote sync.
// Null inputs propagate; existing leads are deliberately not guessed/backfilled.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`create type public.lead_buying_stage as enum ('Pre-Keys', 'Keys Collected', '3D / Design Completed', 'Carpentry Completed', 'Move-In Within 2 Months')`.execute(db);
  await sql`create type public.lead_engagement_quality as enum ('Low', 'Medium', 'High')`.execute(db);
  await db.schema.alterTable("leads")
    .addColumn("renovation_buying_stage", sql`public.lead_buying_stage`)
    .addColumn("engagement_quality", sql`public.lead_engagement_quality`).execute();
  const readiness = "(case renovation_buying_stage when 'Pre-Keys' then 1 when 'Keys Collected' then 2 when '3D / Design Completed' then 3 when 'Carpentry Completed' then 4 when 'Move-In Within 2 Months' then 5 end)";
  const commercial = "(case when latest_quote_cents is null or latest_quote_cents < 0 then null when latest_quote_cents < 60000 then 1 when latest_quote_cents < 90000 then 2 when latest_quote_cents < 120000 then 3 when latest_quote_cents < 180000 then 4 else 5 end)";
  const engagement = "(case engagement_quality when 'Low' then 1 when 'Medium' then 3 when 'High' then 5 end)";
  const total = `(${readiness} * 8 + ${commercial} * 8 + ${engagement} * 4)`;
  const columns = [
    ["readiness_score", readiness, "integer"],
    ["commercial_value_score", commercial, "integer"],
    ["engagement_quality_score", engagement, "integer"],
    ["priority_score", total, "integer"],
    ["priority_class", `case when ${total} is null then null when ${total} >= 80 then 'A' when ${total} >= 65 then 'B' when ${total} >= 45 then 'C' else 'D' end`, "text"],
  ];
  // Add all stored expressions together to avoid rewriting the table five times.
  await sql.raw(`alter table public.leads ${columns.map(([name, expression, type]) => `add column ${name} ${type} generated always as (${expression}) stored`).join(", ")}`).execute(db);
}
export async function down(db: Kysely<unknown>): Promise<void> {
  for (const name of ["priority_class", "priority_score", "engagement_quality_score", "commercial_value_score", "readiness_score", "engagement_quality", "renovation_buying_stage"]) {
    await db.schema.alterTable("leads").dropColumn(name).execute();
  }
  await sql`drop type public.lead_engagement_quality`.execute(db);
  await sql`drop type public.lead_buying_stage`.execute(db);
}
