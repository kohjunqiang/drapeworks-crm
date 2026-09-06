import Link from "next/link";

import { ZohoConnectionActions } from "@/components/admin/zoho-connection-actions";
import { buttonVariants } from "@/components/ui/button";
import { requireRole } from "@/lib/auth/require-role";
import { chooseZohoOrganization } from "@/lib/actions/zoho-integration";
import type { Json } from "@/lib/db/schema";
import { getZohoConnectionSummary } from "@/lib/zoho/connection";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Zoho Books Integration — Drapeworks CRM" };

const RESULT_MESSAGES: Record<string, string> = {
  connected: "Zoho Books connected and verified.", partial: "Zoho authorized the CRM, but one or more required capabilities are unavailable.",
  pending_organization: "Authorization succeeded. Select the Zoho Books organization to finish setup.", cancelled: "Zoho authorization was cancelled.",
  expired: "That connection request expired. Start again.", invalid_callback: "Zoho returned an incomplete authorization response.",
  organization: "The Zoho organization could not be verified for this CRM.", failed: "Zoho Books could not be connected. Try again.",
};

function capability(value: Json, key: string): boolean {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && value[key] === true);
}

export default async function ZohoIntegrationPage({ searchParams }: { searchParams: Promise<{ result?: string }> }) {
  await requireRole(["admin"]);
  const [{ result }, summary] = await Promise.all([searchParams, getZohoConnectionSummary()]);
  const connection = summary.connection;
  const pending = summary.pending;
  const connected = Boolean(connection && connection.status !== "disconnected");
  const connectLabel = pending ? "Restart authorization" : connection && connection.status !== "disconnected" ? "Reconnect Zoho Books" : "Connect Zoho Books";
  const candidates = pending && Array.isArray(pending.candidate_organizations)
    ? pending.candidate_organizations as unknown as Array<{ organization_id?: string; name?: string; currency_code?: string; country_code?: string }> : [];
  const caps = connection?.verified_capabilities ?? {};

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6">
        <p className="text-sm font-medium text-teal-700">Admin · Integrations</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Zoho Books</h1>
        <p className="mt-1 text-sm text-slate-600">Connect the accounting organization used for official customer quotations and deposit invoices.</p>
      </div>
      {result && RESULT_MESSAGES[result] && <div className="mb-4 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">{RESULT_MESSAGES[result]}</div>}
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold text-slate-900">Zoho Books connection</h2>
              <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", connection?.status === "connected" ? "bg-emerald-100 text-emerald-800" : connection?.status === "partial" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700")}>{connection?.status?.replaceAll("_", " ") ?? "disconnected"}</span>
            </div>
            {connection?.organization_name ? <p className="mt-2 text-sm text-slate-700">{connection.organization_name} · {connection.currency_code} · Organization {connection.organization_id}</p> : <p className="mt-2 text-sm text-slate-600">No Zoho Books organization is connected.</p>}
            {connection?.api_domain && <p className="mt-1 text-xs text-slate-500">Data centre: {connection.api_domain}</p>}
          </div>
          {summary.appConfigured ? <Link href="/api/integrations/zoho/connect" className={buttonVariants()}>{connectLabel}</Link> : <span aria-disabled="true" className={cn(buttonVariants(), "cursor-not-allowed opacity-50")}>{connectLabel}</span>}
        </div>

        {!summary.appConfigured && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">The deployment OAuth application is not configured. Add the server application client ID, secret, encryption key and callback URL first.</p>}
        {connection?.status === "partial" && <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Quotation and invoice actions are disabled. An admin must reconnect Zoho Books after checking the required permissions, CRM Quote Key field, and quotation template.</p>}

        {pending && candidates.length > 0 && (
          <div className="mt-5 border-t border-slate-200 pt-5">
            <h3 className="text-sm font-semibold">Choose an organization</h3>
            <div className="mt-2 space-y-2">{candidates.map((candidate) => <form key={candidate.organization_id} action={chooseZohoOrganization} className="flex items-center justify-between rounded-lg border p-3"><input type="hidden" name="pendingId" value={pending.id} /><input type="hidden" name="organizationId" value={candidate.organization_id} /><span className="text-sm">{candidate.name} · {candidate.currency_code} · {candidate.country_code}</span><button className={buttonVariants({ size: "sm" })}>Select</button></form>)}</div>
          </div>
        )}

        {connection && (
          <div className="mt-5 border-t border-slate-200 pt-5">
            <h3 className="text-sm font-semibold text-slate-900">Verified capabilities</h3>
            <ul className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
              <li>{capability(caps, "contactsRead") ? "✓" : "–"} Read customers</li>
              <li>{capability(caps, "estimatesRead") ? "✓" : "–"} Read quotations and PDFs</li>
              <li>{capability(caps, "invoicesRead") ? "✓" : "–"} Read invoices</li>
              <li>{capability(caps, "crmKeyFieldVerified") ? "✓" : "–"} CRM Quote Key field verified</li>
              <li>{capability(caps, "templateVerified") ? "✓" : "–"} Quotation template verified</li>
              <li>OAuth consent: create customers, create/update quotations, create invoices</li>
            </ul>
            {connection.last_verified_at && <p className="mt-3 text-xs text-slate-500">Last verified {new Date(connection.last_verified_at).toLocaleString("en-SG", { timeZone: "Asia/Singapore" })}</p>}
            {connection.last_error && <p className="mt-2 text-sm text-red-700">{connection.last_error}</p>}
          </div>
        )}
        <div className="mt-5 border-t border-slate-200 pt-5">
          <h3 className="text-sm font-semibold text-slate-900">Operational summary</h3>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
            {[
              { label: "Linked customers", value: summary.operational.customerLinks }, { label: "Quotations", value: summary.operational.estimates },
              { label: "Invoices", value: summary.operational.invoices }, { label: "Interrupted", value: summary.operational.interrupted, href: "/orders?zohoAttention=1" },
              { label: "Needs attention", value: summary.operational.failures, href: "/orders?zohoAttention=1" },
            ].map(({ label, value, href }) => <div key={label} className="rounded-lg bg-slate-50 p-3"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 text-lg font-semibold text-slate-900">{href ? <Link className="underline decoration-slate-300 underline-offset-2" href={href}>{value}</Link> : value}</dd></div>)}
          </dl>
        </div>
        <div className="mt-5"><ZohoConnectionActions connected={connected} pendingSetup={Boolean(pending)} canTest={Boolean(connection && ["connected", "partial"].includes(connection.status))} /></div>
      </section>
      <p className="mt-4 text-xs text-slate-500">Disconnecting the CRM never deletes quotations, invoices or customers from Zoho Books. Existing official PDFs remain available in the CRM.</p>
    </main>
  );
}
