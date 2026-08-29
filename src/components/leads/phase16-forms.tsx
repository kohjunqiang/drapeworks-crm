"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { acceptRecommendation, archiveLead, createLead, dismissRecommendation, editLeadDetails, logLeadUpdate } from "@/lib/actions/leads";
import { CLOSURE_REASONS, CONTACT_CHANNELS, FUNNEL_STAGES, INTERACTION_TYPES, LEAD_DIRECTIONS, LEAD_OUTCOMES, LEAD_SOURCES, PRIMARY_PRODUCTS, type FunnelStage, type Recommendation } from "@/lib/leads/funnel-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const Select = ({name, defaultValue, children, required=false}:{name:string;defaultValue?:string|null;children:React.ReactNode;required?:boolean}) =>
  <select name={name} defaultValue={defaultValue ?? ""} required={required} className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm">{children}</select>;
const options = (values:readonly string[]) => <>{values.map(value=><option key={value} value={value}>{value}</option>)}</>;
function useSubmit(action:(value:Record<string,FormDataEntryValue>)=>Promise<unknown>){
  const [pending,start]=useTransition(); const router=useRouter();
  return {pending,submit:(form:HTMLFormElement)=>start(async()=>{try{await action(Object.fromEntries(new FormData(form)));toast.success("Saved");router.refresh()}catch(error){toast.error(error instanceof Error?error.message:"Save failed")}})};
}

export function NewLeadForm(){
  const state=useSubmit(createLead);
  return <form onSubmit={e=>{e.preventDefault();state.submit(e.currentTarget)}} className="space-y-4 bg-white border rounded-lg p-4 sm:p-6">
    <div className="grid sm:grid-cols-2 gap-4"><Input name="name" placeholder="Customer name" required/><Input name="mobile" placeholder="Mobile"/><Input name="development" placeholder="Development"/><Select name="contact_channel" required><option value="">Contact channel</option>{options(CONTACT_CHANNELS)}</Select><Select name="source"><option value="">Lead source</option>{options(LEAD_SOURCES)}</Select><Select name="inbound_outbound"><option value="">Direction</option>{options(LEAD_DIRECTIONS)}</Select><Select name="primary_product"><option value="">Primary product</option>{options(PRIMARY_PRODUCTS)}</Select><Select name="funnel_stage" defaultValue="Qualify Lead">{options(FUNNEL_STAGES)}</Select></div>
    <Textarea name="interaction_summary" placeholder="Interaction summary"/><Button type="submit" disabled={state.pending}>{state.pending?"Creating…":"Create lead"}</Button>
  </form>;
}

export function LogUpdateForm({lead}:{lead:{id:string;funnel_stage:FunnelStage;interaction_summary:string|null;action_detail:string|null;quote_valid_days:number}}){
  const [stage,setStage]=useState(lead.funnel_stage); const [seenStage,setSeenStage]=useState(lead.funnel_stage);
  const [outcome,setOutcome]=useState(""); const [interactionType,setInteractionType]=useState("Reply"); const [direction,setDirection]=useState("Outbound");
  if(lead.funnel_stage!==seenStage){setSeenStage(lead.funnel_stage);setStage(lead.funnel_stage)}
  const state=useSubmit(logLeadUpdate);
  const selectOutcome=(value:string)=>{setOutcome(value);const defaults:Record<string,[string,string]>={"Customer Replied":["Customer Message","Inbound"],"Awaiting Customer":["Reply","Outbound"],"No Response":["Follow-Up","Outbound"],"Pre-Appointment Barrier":["Customer Message","Inbound"],"Appointment Booked":["Appointment","Outbound"],"Quotation Sent":["Quote","Outbound"],"Post-Appointment Barrier":["Customer Message","Inbound"],"Customer Declined":["Customer Message","Inbound"],"Customer Confirmed":["Customer Message","Inbound"]};const next=defaults[value];if(next){setInteractionType(next[0]);setDirection(next[1])}};
  return <form onSubmit={e=>{e.preventDefault();state.submit(e.currentTarget)}} className="space-y-4">
    <input type="hidden" name="lead_id" value={lead.id}/>
    <div className="grid sm:grid-cols-2 gap-3"><select name="last_outcome" required value={outcome} onChange={event=>selectOutcome(event.target.value)} className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"><option value="">Last contact outcome</option>{options(LEAD_OUTCOMES)}</select><select name="interaction_type" value={interactionType} onChange={event=>setInteractionType(event.target.value)} className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm">{options(INTERACTION_TYPES)}</select><select name="direction" value={direction} onChange={event=>setDirection(event.target.value)} className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"><option value="">No direction</option>{options(LEAD_DIRECTIONS)}</select><Input name="next_action_date" type="date"/><select name="funnel_stage" value={stage} onChange={e=>setStage(e.target.value as FunnelStage)} className="h-10 rounded-md border px-3">{options(FUNNEL_STAGES)}</select>{(stage==="Lost"||stage==="Not Qualified")&&<Select name="closure_reason" required><option value="">Closure reason</option>{options(CLOSURE_REASONS)}</Select>}</div>
    <Input key={lead.action_detail??""} name="action_detail" defaultValue={lead.action_detail??""} placeholder="Specific next action"/><Textarea name="note" placeholder="Timeline note"/><Textarea key={lead.interaction_summary??""} name="interaction_summary" defaultValue={lead.interaction_summary??""} placeholder="Interaction summary"/>
    <details><summary className="text-sm font-medium cursor-pointer">Quotation</summary><div className="grid sm:grid-cols-2 gap-3 mt-3"><Input name="latest_quote_sgd" type="number" step="0.01" placeholder="Quote value (SGD)"/><Input name="quotation_sent_date" type="date"/><Input name="quote_valid_days" type="number" defaultValue={lead.quote_valid_days}/><Input name="quotation_breakdown" placeholder="Breakdown"/></div></details>
    <Button type="submit" disabled={state.pending}>{state.pending?"Logging…":"Log update"}</Button>
  </form>;
}

export function DetailsForm({lead,consultants}:{lead:any;consultants:{id:string;full_name:string|null}[]}){
  const state=useSubmit(editLeadDetails); const [pending,start]=useTransition();
  return <form onSubmit={e=>{e.preventDefault();state.submit(e.currentTarget)}} className="space-y-4">
    <input type="hidden" name="id" value={lead.id}/><input type="hidden" name="expected_updated_at" value={new Date(lead.updated_at).toISOString()}/>
    <div className="grid sm:grid-cols-2 gap-3"><Input name="name" defaultValue={lead.name}/><Input name="mobile" defaultValue={lead.mobile??""}/><Input name="development" defaultValue={lead.development??""}/><Select name="contact_channel" defaultValue={lead.contact_channel}>{options(CONTACT_CHANNELS)}</Select><Select name="source" defaultValue={lead.source}><option value="">Unknown source</option>{options(LEAD_SOURCES)}</Select><Select name="inbound_outbound" defaultValue={lead.inbound_outbound}><option value="">Unknown direction</option>{options(LEAD_DIRECTIONS)}</Select><Select name="primary_product" defaultValue={lead.primary_product}><option value="">Unknown product</option>{options(PRIMARY_PRODUCTS)}</Select><Select name="assigned_consultant_id" defaultValue={lead.assigned_consultant_id}><option value="">Unassigned</option>{consultants.map(c=><option key={c.id} value={c.id}>{c.full_name??"Unnamed"}</option>)}</Select><Input name="move_in_date" type="date" defaultValue={lead.move_in_date_text??""}/><Select name="keys_collected" defaultValue={lead.keys_collected===null?"":String(lead.keys_collected)}><option value="">Keys unknown</option><option value="true">Keys collected</option><option value="false">Keys not collected</option></Select><Select name="closure_reason" defaultValue={lead.closure_reason}><option value="">No closure reason</option>{options(CLOSURE_REASONS)}</Select></div>
    <div className="flex gap-2"><Button type="submit" disabled={state.pending}>Save details</Button><Button type="button" variant="outline" disabled={pending||lead.is_archived} onClick={()=>start(async()=>{await archiveLead({lead_id:lead.id});toast.success("Lead archived")})}>Archive</Button></div>
  </form>;
}

export function RecommendationBanner({leadId,recommendation}:{leadId:string;recommendation:Recommendation}){
  const [pending,start]=useTransition(); const [reason,setReason]=useState("");
  const run=(accept:boolean)=>start(async()=>{try{await(accept?acceptRecommendation:dismissRecommendation)({lead_id:leadId,code:recommendation.code,...(reason?{closure_reason:reason}:{})});toast.success(accept?"Recommendation applied":"Dismissed")}catch(error){toast.error(error instanceof Error?error.message:"Failed")}});
  return <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"><span>{recommendation.message}</span><div className="flex flex-wrap gap-2">{recommendation.suggestedStage==="Lost"&&<select value={reason} onChange={e=>setReason(e.target.value)} className="h-9 rounded border bg-white px-2 text-sm"><option value="">Closure reason</option>{options(CLOSURE_REASONS)}</select>}{recommendation.suggestedStage&&<Button size="sm" disabled={pending||(recommendation.suggestedStage==="Lost"&&!reason)} onClick={()=>run(true)}>Accept</Button>}<Button size="sm" variant="outline" disabled={pending} onClick={()=>run(false)}>Dismiss</Button></div></div>;
}
