import Link from "next/link";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createLead } from "@/lib/actions/leads";
import { requireRole } from "@/lib/auth/require-role";
import { FUNNEL_STAGES, LEAD_STATUSES } from "@/lib/leads/types";

export const metadata = { title: "New lead — Drapeworks CRM" };

const LABEL = "text-xs font-medium uppercase tracking-wide text-slate-500";
const FIELD = "mt-1 h-9 border-slate-200";
// Native <select> on purpose. This page ships no client JavaScript — the form
// posts straight to a Server Action that redirects — and base-ui's Select is a
// listbox that never appears in FormData. Styled to match the Input primitive
// so the two read as one form.
const SELECT =
  "mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-900 outline-none focus-visible:border-teal-600 focus-visible:ring-3 focus-visible:ring-teal-600/50";

export default async function NewLeadPage() {
  await requireRole(["consultant", "admin"]);

  async function submit(formData: FormData) {
    "use server";
    // createLead re-checks the role and validates with Zod; this closure is
    // only here to turn the form into the shape the action wants.
    await createLead({
      name: formData.get("name"),
      mobile: formData.get("mobile"),
      development: formData.get("development"),
      funnel_stage: formData.get("funnel_stage"),
      lead_status: formData.get("lead_status"),
      interaction_summary: formData.get("interaction_summary"),
    });
  }

  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <Link
        href="/leads"
        className="text-sm text-slate-500 hover:text-slate-700"
      >
        ← Back to leads
      </Link>

      <h1 className="text-xl sm:text-2xl font-bold text-slate-900 mt-3">
        New lead
      </h1>
      <p className="text-sm text-slate-500 mt-1">
        For a walk-in or a referral that never came through Telegram or
        WhatsApp.
      </p>

      <form
        action={submit}
        className="mt-6 bg-white rounded-lg border border-slate-200 p-4 sm:p-6 space-y-4"
      >
        <div>
          <Label htmlFor="name" className={LABEL}>
            Name
          </Label>
          <Input id="name" name="name" required className={FIELD} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          <div>
            <Label htmlFor="mobile" className={LABEL}>
              Mobile
            </Label>
            <Input id="mobile" name="mobile" className={FIELD} />
          </div>
          <div>
            <Label htmlFor="development" className={LABEL}>
              Development
            </Label>
            <Input id="development" name="development" className={FIELD} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          <div>
            <Label htmlFor="funnel_stage" className={LABEL}>
              Funnel stage
            </Label>
            <select
              id="funnel_stage"
              name="funnel_stage"
              defaultValue="New Lead"
              className={SELECT}
            >
              {FUNNEL_STAGES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="lead_status" className={LABEL}>
              Lead status
            </Label>
            <select
              id="lead_status"
              name="lead_status"
              defaultValue="Active"
              className={SELECT}
            >
              {LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <Label htmlFor="interaction_summary" className={LABEL}>
            Interaction summary
          </Label>
          <Textarea
            id="interaction_summary"
            name="interaction_summary"
            rows={3}
            className="mt-1 min-h-16 border-slate-200"
          />
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 sm:gap-3">
          <Link
            href="/leads"
            className="inline-flex items-center justify-center px-4 py-2 rounded text-sm text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </Link>
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded font-medium text-sm"
          >
            Create lead
          </button>
        </div>
      </form>
    </main>
  );
}
