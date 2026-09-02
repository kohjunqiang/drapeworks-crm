"use server";
import "server-only";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/require-role";
import { syncAppointment, unsyncAppointment } from "@/lib/calendar/sync";
import { db } from "@/lib/db/kysely";
import { appointmentCreateSchema, appointmentRescheduleSchema, appointmentStatusSchema } from "@/lib/validation/appointment";
import type { FunnelStage } from "@/lib/leads/funnel-types";
const sgInstant=(date:string,time:string)=>new Date(`${date}T${time}:00+08:00`);
const refresh=(leadId:string)=>{revalidatePath("/queue");revalidatePath("/leads");revalidatePath(`/leads/${leadId}`)};
const BOOKABLE_STAGES = new Set<FunnelStage>(["Book Appointment", "Attend Appointment"]);

export async function bookAppointment(input:unknown):Promise<void>{
  const session=await requireRole(["consultant","admin"]);const p=appointmentCreateSchema.parse(input);
  const appointmentId=await db.transaction().execute(async trx=>{
    const occurredAt=new Date();const scheduledAt=sgInstant(p.date,p.time);
    const before=await trx.selectFrom("leads")
      .select(["funnel_stage","last_outcome","next_action_date","is_archived"])
      .where("id","=",p.lead_id).forUpdate().executeTakeFirst();
    if(!before||before.is_archived)throw new Error("This lead is no longer available");
    if(!BOOKABLE_STAGES.has(before.funnel_stage))throw new Error("Move this lead to Book Appointment before booking");
    const existing=await trx.selectFrom("appointments").select("id")
      .where("lead_id","=",p.lead_id).where("status","=","scheduled").executeTakeFirst();
    if(existing)throw new Error("This lead already has a scheduled appointment");
    const consultant=await trx.selectFrom("profiles").select("id")
      .where("id","=",p.consultant_id).where("is_active","=",true)
      .where("role","in",["consultant","admin"]).executeTakeFirst();
    if(!consultant)throw new Error("Select an active consultant");
    const customerId=p.customer.mode==="existing"?p.customer.customer_id:(await trx.insertInto("customers").values({name:p.customer.name,mobile:p.customer.mobile,email:p.customer.email||null,created_by:session.user.id}).returning("id").executeTakeFirstOrThrow()).id;
    const appointment=await trx.insertInto("appointments").values({lead_id:p.lead_id,customer_id:customerId,scheduled_at:scheduledAt,duration_mins:p.duration_mins,development:p.development??null,address:p.address??null,notes:p.notes??null,status:"scheduled",lead_stage_before:before.funnel_stage,lead_outcome_before:before.last_outcome,lead_action_date_before:before.next_action_date,google_sync_state:"pending",created_by:session.user.id}).returning("id").executeTakeFirstOrThrow();
    await trx.insertInto("appointment_events").values({appointment_id:appointment.id,lead_id:p.lead_id,event_type:"booked",occurred_at:occurredAt,scheduled_at:scheduledAt,created_by:session.user.id}).execute();
    await trx.updateTable("leads").set({customer_id:customerId,funnel_stage:"Attend Appointment",last_outcome:"Appointment Booked",next_action_date:p.date,assigned_consultant_id:p.consultant_id,updated_at:new Date()}).where("id","=",p.lead_id).execute();
    if(before.funnel_stage!=="Attend Appointment")await trx.insertInto("lead_stage_events").values({lead_id:p.lead_id,from_stage:before.funnel_stage,to_stage:"Attend Appointment",changed_at:occurredAt,changed_by:session.user.id,source:"system"}).execute();return appointment.id;
  });
  await syncAppointment(appointmentId);refresh(p.lead_id);
}

export async function rescheduleAppointment(input:unknown):Promise<void>{
  const session=await requireRole(["consultant","admin"]);const p=appointmentRescheduleSchema.parse(input);
  const leadId=await db.transaction().execute(async trx=>{
    const occurredAt=new Date();const scheduledAt=sgInstant(p.date,p.time);
    const before=await trx.selectFrom("appointments").select(["lead_id","scheduled_at"]).where("id","=",p.id).where("status","=","scheduled").forUpdate().executeTakeFirst();
    if(!before)throw new Error("This appointment is no longer scheduled. Reload and try again.");
    const lead=await trx.selectFrom("leads").select("is_archived").where("id","=",before.lead_id).forUpdate().executeTakeFirst();
    if(!lead||lead.is_archived)throw new Error("This lead is no longer available");
    const updated=await trx.updateTable("appointments").set({scheduled_at:scheduledAt,duration_mins:p.duration_mins,updated_at:occurredAt}).where("id","=",p.id).where("status","=","scheduled").returning("lead_id").executeTakeFirst();
    if(!updated)throw new Error("This appointment is no longer scheduled. Reload and try again.");
    await trx.insertInto("appointment_events").values({appointment_id:p.id,lead_id:updated.lead_id,event_type:"rescheduled",occurred_at:occurredAt,scheduled_at:scheduledAt,previous_scheduled_at:before.scheduled_at,created_by:session.user.id}).execute();
    await trx.updateTable("leads").set({next_action_date:p.date,updated_at:occurredAt}).where("id","=",updated.lead_id).execute();
    await trx.insertInto("lead_interactions").values({lead_id:updated.lead_id,occurred_at:occurredAt,direction:null,interaction_type:"Appointment",note:"Appointment rescheduled",created_by:session.user.id}).execute();return updated.lead_id;
  });
  await syncAppointment(p.id);refresh(leadId);
}

export async function setAppointmentStatus(input:unknown):Promise<void>{
  const session=await requireRole(["consultant","admin"]);const p=appointmentStatusSchema.parse(input);
  const leadId=await db.transaction().execute(async trx=>{
    const occurredAt=new Date();
    const appointmentRef=await trx.selectFrom("appointments").select("lead_id").where("id","=",p.id).where("status","=","scheduled").executeTakeFirst();
    if(!appointmentRef)throw new Error("This appointment is no longer scheduled — reload to see its current status.");
    const draftOrder=await trx.selectFrom("orders").select("id")
      .where("lead_id","=",appointmentRef.lead_id).where("is_draft","=",true)
      .forUpdate().executeTakeFirst();
    if(draftOrder)throw new Error("Continue or delete the consultation draft before changing this appointment status");
    const before=await trx.selectFrom("appointments").select("lead_id").where("id","=",p.id).where("status","=","scheduled").forUpdate().executeTakeFirst();
    if(!before)throw new Error("This appointment is no longer scheduled — reload to see its current status.");
    // A draft can be inserted after the first read but before we acquire the
    // appointment lock. Recheck while holding that lock: creating an order for
    // this appointment must now wait, so this closes the race without reversing
    // the global order -> appointment lock order when a draft already exists.
    const concurrentDraft=await trx.selectFrom("orders").select("id")
      .where("lead_id","=",before.lead_id).where("is_draft","=",true)
      .executeTakeFirst();
    if(concurrentDraft)throw new Error("Continue or delete the consultation draft before changing this appointment status");
    const lead=await trx.selectFrom("leads").select("is_archived").where("id","=",before.lead_id).forUpdate().executeTakeFirst();
    if(!lead||lead.is_archived)throw new Error("This lead is no longer available");
    const updated=await trx.updateTable("appointments").set({status:p.status,updated_at:occurredAt}).where("id","=",p.id).where("status","=","scheduled").returning(["lead_id","scheduled_at","lead_stage_before","lead_outcome_before","lead_action_date_before"]).executeTakeFirst();
    if(!updated)throw new Error("This appointment is no longer scheduled — reload to see its current status.");
    await trx.insertInto("appointment_events").values({appointment_id:p.id,lead_id:updated.lead_id,event_type:p.status,occurred_at:occurredAt,scheduled_at:updated.scheduled_at,created_by:session.user.id}).execute();
    if(p.status==="cancelled"||p.status==="no_show"){
      const target=updated.lead_stage_before??"Book Appointment";
      await trx.updateTable("leads").set({funnel_stage:target,last_outcome:updated.lead_outcome_before,next_action_date:updated.lead_action_date_before as Date|null,updated_at:occurredAt}).where("id","=",updated.lead_id).execute();
      await trx.insertInto("lead_stage_events").values({lead_id:updated.lead_id,from_stage:"Attend Appointment",to_stage:target,changed_at:occurredAt,changed_by:session.user.id,source:"system"}).execute();
    }
    return updated.lead_id;
  });
  if(p.status==="cancelled"||p.status==="no_show")await unsyncAppointment(p.id);refresh(leadId);
}

export async function retryAppointmentSync(appointmentId:string):Promise<void>{await requireRole(["consultant","admin"]);const result=await syncAppointment(appointmentId);if(!result.ok)throw new Error(result.error);const row=await db.selectFrom("appointments").select("lead_id").where("id","=",appointmentId).executeTakeFirstOrThrow();revalidatePath(`/leads/${row.lead_id}`)}
