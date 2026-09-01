import type { FunnelStage } from "@/lib/leads/funnel-types";

const BLUE_STAGES: readonly FunnelStage[] = [
  "Qualify Lead",
  "Nurture Lead – Long Term",
  "Activate Lead – Short Term",
  "Book Appointment",
];

const GREEN_STAGES: readonly FunnelStage[] = [
  "Send Quotation",
  "Collect Deposit",
  "Decision Pending",
];

export function funnelStagePillClass(stage: FunnelStage) {
  if (BLUE_STAGES.includes(stage)) {
    return "border-blue-200 bg-blue-50 text-blue-700";
  }
  if (stage === "Attend Appointment") {
    return "border-orange-200 bg-orange-50 text-orange-700";
  }
  if (GREEN_STAGES.includes(stage)) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  return "border-slate-200 bg-slate-100 text-slate-600";
}

export function FunnelStagePill({ stage }: { stage: FunnelStage }) {
  return (
    <span
      className={`inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-xs font-medium leading-4 ${funnelStagePillClass(stage)}`}
    >
      {stage}
    </span>
  );
}
