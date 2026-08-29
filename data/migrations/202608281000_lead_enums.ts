import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter type lead_funnel_stage rename to lead_funnel_stage_legacy`.execute(db);
  await sql`alter type lead_status rename to lead_status_legacy`.execute(db);
  await sql`alter type lead_outcome rename to lead_outcome_legacy`.execute(db);
  await sql`alter type lead_source rename to lead_source_legacy`.execute(db);
  await sql`create type lead_funnel_stage as enum ('Qualify Lead','Nurture Lead – Long Term','Activate Lead – Short Term','Book Appointment','Attend Appointment','Send Quotation','Collect Deposit','Decision Pending','Won','Lost','Not Qualified')`.execute(db);
  await sql`create type lead_status as enum ('Active','Unresponsive','Closed – Won','Closed – Lost','Closed – Not Qualified')`.execute(db);
  await sql`create type lead_outcome as enum ('Customer Replied','Awaiting Customer','No Response','Pre-Appointment Barrier','Appointment Booked','Quotation Sent','Post-Appointment Barrier','Customer Declined','Customer Confirmed')`.execute(db);
  await sql`create type lead_contact_channel as enum ('Telegram','WhatsApp','Other')`.execute(db);
  await sql`create type lead_source as enum ('Telegram Group Buy','SEM','Organic','Carousell','Referral','Existing Customer','Other')`.execute(db);
  await sql`create type lead_direction as enum ('Inbound','Outbound')`.execute(db);
  await sql`create type lead_primary_product as enum ('Curtains / Blinds','Mesh','Both')`.execute(db);
  await sql`create type lead_closure_reason as enum ('Competitor','Price / Budget','Ghosted','Small Order / Low Value','Product Mismatch','Timing / No Longer Needed','Communication / Poor Fit','Outside Scope','Other')`.execute(db);
  await sql`create type interaction_type as enum ('Customer Message','Reply','Follow-Up','Appointment','Quote','Payment','Note')`.execute(db);
}
export async function down(db: Kysely<unknown>): Promise<void> {
  for (const name of ["interaction_type","lead_closure_reason","lead_primary_product","lead_direction","lead_source","lead_contact_channel","lead_outcome","lead_status","lead_funnel_stage"]) await sql.raw(`drop type ${name}`).execute(db);
  await sql`alter type lead_source_legacy rename to lead_source`.execute(db); await sql`alter type lead_outcome_legacy rename to lead_outcome`.execute(db); await sql`alter type lead_status_legacy rename to lead_status`.execute(db); await sql`alter type lead_funnel_stage_legacy rename to lead_funnel_stage`.execute(db);
}
