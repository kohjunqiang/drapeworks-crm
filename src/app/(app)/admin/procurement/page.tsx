import { PoLabelsPanel } from "@/components/procurement/po-labels-panel";
import { ProcurementSettingsForm } from "@/components/procurement/procurement-settings-form";
import { requireRole } from "@/lib/auth/require-role";
import {
  loadBlindSeriesNames,
  loadPoOpeningLabels,
  loadPoTypeLabels,
  loadProcurementSettings,
  loadRoomTypeLabels,
} from "@/lib/db/procurement";

export const dynamic = "force-dynamic";

export const metadata = { title: "Procurement — Drapeworks CRM" };

// Everything a Chinese purchase order (采购订单) needs that only the business
// can supply. The labels come FIRST: they are what blocks generation today, and
// they are why anyone opens this page. The company block below them changes
// once a year.
export default async function ProcurementPage() {
  await requireRole(["admin"]);

  const [settings, roomLabels, typeLabels, openingLabels, blindSeries] =
    await Promise.all([
      loadProcurementSettings(),
      loadRoomTypeLabels(),
      loadPoTypeLabels(),
      loadPoOpeningLabels(),
      loadBlindSeriesNames(),
    ]);

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
          Procurement
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          What the purchase orders sent to the factories are made of. The
          documents are in Chinese and every cell of one is a cutting
          instruction, so anything the system does not know it refuses to print
          — and this is where it gets told.
        </p>
      </div>

      <div className="space-y-6">
        <PoLabelsPanel
          roomLabels={roomLabels}
          typeLabels={typeLabels}
          openingLabels={openingLabels}
          blindSeries={blindSeries}
        />

        {settings ? (
          <ProcurementSettingsForm settings={settings} />
        ) : (
          <section className="bg-white rounded-lg border border-slate-200 p-4 sm:p-5">
            <h2 className="text-base font-semibold text-slate-900">
              Company &amp; delivery
            </h2>
            <p className="text-sm text-red-600 mt-2">
              No procurement settings row found — the migration seeds one; re-run
              `npm run db:migrate`.
            </p>
          </section>
        )}

        <p className="text-xs text-slate-500">
          Curtain style (窗帘款式), heat setting (定型) and floor clearance
          (窗帘离地) appear on <strong>curtain</strong> purchase orders only. All
          three labels are printed but left blank on the Blinds sample, which is
          correct — a blind has none of them. Vendor contact details live on{" "}
          <strong>Admin → Vendors</strong>; a vendor missing them still generates
          a PO, with those lines omitted.
        </p>
      </div>
    </main>
  );
}
