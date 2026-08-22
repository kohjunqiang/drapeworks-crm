"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { AppSelect } from "@/components/ui/app-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateLead } from "@/lib/actions/leads";
import {
  FUNNEL_STAGES,
  LEAD_OUTCOMES,
  LEAD_STATUSES,
  type FunnelStage,
  type LeadOutcome,
  type LeadStatusValue,
} from "@/lib/leads/types";

export type LeadFormValues = {
  id: string;
  name: string;
  mobile: string | null;
  development: string | null;
  funnel_stage: FunnelStage;
  lead_status: LeadStatusValue;
  last_outcome: LeadOutcome | null;
  action_date: string | null;
  action_detail_override: string | null;
  interaction_summary: string | null;
  latest_quote_cents: number | null;
  latest_quote_note: string | null;
  // Not edited here, but see the comment on the payload below: they have to
  // make the round trip or saving anything wipes them.
  buying_readiness: string | null;
  keys_status: string | null;
  expected_key_date: string | null;
};

const LABEL = "text-xs font-medium uppercase tracking-wide text-slate-500";
const FIELD = "mt-1 h-9 border-slate-200";

const asOptions = (values: readonly string[]) =>
  values.map((v) => ({ value: v, label: v }));

export function LeadFieldsForm({ lead }: { lead: LeadFormValues }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  // The three hand-set selects drive everything the engine derives, so they are
  // controlled: base-ui's Select renders a listbox, not a native <select>, and
  // never appears in FormData.
  const [funnelStage, setFunnelStage] = useState<string>(lead.funnel_stage);
  const [leadStatus, setLeadStatus] = useState<string>(lead.lead_status);
  const [lastOutcome, setLastOutcome] = useState<string>(lead.last_outcome ?? "");

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const text = (key: string) => String(formData.get(key) ?? "");

    start(async () => {
      try {
        await updateLead({
          id: lead.id,
          name: text("name"),
          mobile: text("mobile"),
          development: text("development"),
          funnel_stage: funnelStage,
          lead_status: leadStatus,
          // Zod's enum and date rules reject "", and "" here means absent.
          last_outcome: lastOutcome || undefined,
          action_date: text("action_date") || undefined,
          action_detail_override: text("action_detail_override"),
          interaction_summary: text("interaction_summary"),
          // "" is preprocessed to undefined — an untouched number field must
          // not become a phantom S$0 quote. See validation/lead.ts.
          latest_quote_sgd: text("latest_quote_sgd"),
          // updateLead writes the whole row, so a field the form omits is set
          // to NULL rather than left alone. 238 leads carry buying_readiness
          // and 205 carry keys_status; without this round trip the first save
          // on any lead silently destroys them. Not editable here — carried.
          buying_readiness: lead.buying_readiness ?? undefined,
          keys_status: lead.keys_status ?? undefined,
          expected_key_date: lead.expected_key_date ?? undefined,
        });
        toast.success("Lead updated");
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not save");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <div>
          <Label htmlFor="funnel_stage" className={LABEL}>
            Funnel stage
          </Label>
          <div className="mt-1">
            <AppSelect
              value={funnelStage}
              onChange={setFunnelStage}
              options={asOptions(FUNNEL_STAGES)}
            />
          </div>
        </div>
        <div>
          <Label htmlFor="lead_status" className={LABEL}>
            Lead status
          </Label>
          <div className="mt-1">
            <AppSelect
              value={leadStatus}
              onChange={setLeadStatus}
              options={asOptions(LEAD_STATUSES)}
            />
          </div>
        </div>
        <div>
          <Label htmlFor="last_outcome" className={LABEL}>
            Last contact outcome
          </Label>
          <div className="mt-1">
            <AppSelect
              value={lastOutcome}
              onChange={setLastOutcome}
              noneLabel="—"
              options={asOptions(LEAD_OUTCOMES)}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <div>
          <Label htmlFor="name" className={LABEL}>
            Name
          </Label>
          <Input
            id="name"
            name="name"
            defaultValue={lead.name}
            required
            className={FIELD}
          />
        </div>
        <div>
          <Label htmlFor="mobile" className={LABEL}>
            Mobile
          </Label>
          <Input
            id="mobile"
            name="mobile"
            defaultValue={lead.mobile ?? ""}
            className={FIELD}
          />
        </div>
        <div>
          <Label htmlFor="development" className={LABEL}>
            Development
          </Label>
          <Input
            id="development"
            name="development"
            defaultValue={lead.development ?? ""}
            className={FIELD}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <div>
          <Label htmlFor="action_date" className={LABEL}>
            Action date
          </Label>
          <Input
            type="date"
            id="action_date"
            name="action_date"
            defaultValue={lead.action_date ?? ""}
            className={FIELD}
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="action_detail_override" className={LABEL}>
            Next action override
          </Label>
          <Input
            id="action_detail_override"
            name="action_detail_override"
            defaultValue={lead.action_detail_override ?? ""}
            placeholder="Leave blank to use the derived instruction"
            className={FIELD}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <div>
          <Label htmlFor="latest_quote_sgd" className={LABEL}>
            Latest quote (S$)
          </Label>
          <Input
            id="latest_quote_sgd"
            name="latest_quote_sgd"
            type="number"
            step="0.01"
            min="0"
            defaultValue={
              lead.latest_quote_cents ? lead.latest_quote_cents / 100 : ""
            }
            className={FIELD}
          />
          {/* Two imported leads have negotiation text where a number belongs,
              and their amount was deliberately left NULL rather than guessed.
              Without this the only way to find them after Task 26 deletes the
              import log is a SQL query — the decision would have no path to
              resolution.
              Gated on the amount being absent, not on the note existing: the
              note is never cleared, so it survives as the record of what the
              sheet actually said. Clearing it on save would also work and
              would destroy the only copy of row 237's wording. */}
          {!lead.latest_quote_cents && lead.latest_quote_note ? (
            <p className="mt-1 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800">
              Needs a figure — sheet recorded: &ldquo;{lead.latest_quote_note}
              &rdquo;
            </p>
          ) : null}
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="interaction_summary" className={LABEL}>
            Interaction summary
          </Label>
          <Textarea
            id="interaction_summary"
            name="interaction_summary"
            rows={2}
            defaultValue={lead.interaction_summary ?? ""}
            className="mt-1 min-h-16 border-slate-200"
          />
        </div>
      </div>

      <Button
        type="submit"
        disabled={pending}
        className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 h-auto"
      >
        {pending ? "Saving…" : "Save lead"}
      </Button>
    </form>
  );
}
