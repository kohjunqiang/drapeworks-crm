import { describe, expect, it } from "vitest";
import { deriveActionRequired, deriveBuyingReadiness, deriveCurrentOwner, deriveDueStatus, deriveLeadStatus, deriveRecommendations } from "./funnel-engine";
import type { FunnelEngineInput, FunnelStage, LeadOutcome } from "./funnel-types";
const today="2026-08-29";const lead=(stage:FunnelStage="Qualify Lead",outcome:LeadOutcome|null=null,extra:Partial<FunnelEngineInput>={}):FunnelEngineInput=>({funnel_stage:stage,last_outcome:outcome,next_action_date:null,unanswered_followups:0,move_in_date:null,quotation_sent_at:null,quote_valid_days:7,assigned_consultant_id:null,owner_id:"owner",...extra});
describe("Phase 16 funnel engine",()=>{
  it.each([["Won","Closed – Won"],["Lost","Closed – Lost"],["Not Qualified","Closed – Not Qualified"]] as const)("derives terminal status",(s,x)=>expect(deriveLeadStatus(s,2)).toBe(x));
  it("derives unresponsive only for open leads",()=>expect(deriveLeadStatus("Collect Deposit",2)).toBe("Unresponsive"));
  it.each([["Won","Customer Replied","Won"],["Lost","Customer Replied","Closed"],["Not Qualified","Appointment Booked","Closed"]] as const)("terminal stage wins above outcome",(s,o,x)=>expect(deriveActionRequired(lead(s,o),today)).toBe(x));
  it.each([["Customer Replied","Reply Required"],["No Response","Follow-Up"],["Pre-Appointment Barrier","Resolve Appointment Barrier"],["Appointment Booked","Confirm / Attend Appointment"],["Quotation Sent","Push for Deposit"],["Post-Appointment Barrier","Resolve Closing Barrier"],["Customer Declined","Closed"],["Customer Confirmed","Push for Deposit"]] as const)("maps outcome %s",(o,x)=>expect(deriveActionRequired(lead("Activate Lead – Short Term",o),today)).toBe(x));
  it.each([["Qualify Lead","Qualify Lead"],["Nurture Lead – Long Term","Nurture Lead"],["Activate Lead – Short Term","Activate Lead"],["Book Appointment","Book Appointment"],["Attend Appointment","Confirm / Attend Appointment"],["Send Quotation","Send Quotation"],["Collect Deposit","Push for Deposit"],["Decision Pending","Push for Decision"]] as const)("maps stage %s",(s,x)=>expect(deriveActionRequired(lead(s),today)).toBe(x));
  it.each([["2026-08-30","Awaiting Customer"],["2026-08-29","Follow-Up"],["2026-08-28","Follow-Up"],[null,"Awaiting Customer"]] as const)("matches Excel's nonblank date gate for awaiting customer",(d,x)=>expect(deriveActionRequired(lead("Activate Lead – Short Term","Awaiting Customer",{next_action_date:d}),today)).toBe(x));
  it("defaults customer work due today",()=>expect(deriveDueStatus("Reply Required",null,today)).toBe("Due Today"));
  it.each([["Nurture Lead – Long Term","Low"],["Activate Lead – Short Term","Medium"],["Book Appointment","High"],["Won",null]] as const)("derives readiness",(s,x)=>expect(deriveBuyingReadiness(s)).toBe(x));
  it("keeps won ownership with consultant",()=>expect(deriveCurrentOwner(lead("Won",null,{assigned_consultant_id:"consultant"}),"presales")).toBe("consultant"));
  it("keeps not-qualified ownership in presales",()=>expect(deriveCurrentOwner(lead("Not Qualified"),"presales")).toBe("presales"));
  it("never recommends on terminal stages",()=>expect(deriveRecommendations(lead("Not Qualified","Appointment Booked"),today)).toEqual([]));
  it("quote aging clears the overriding outcome",()=>expect(deriveRecommendations(lead("Collect Deposit","Quotation Sent",{quotation_sent_at:"2026-08-20"}),today)).toContainEqual(expect.objectContaining({code:"quote-aged",clearsOutcome:true})));
  it("does not recommend Won from customer intent without a recorded deposit",()=>expect(deriveRecommendations(lead("Decision Pending","Customer Confirmed"),today)).toEqual([]));
});
