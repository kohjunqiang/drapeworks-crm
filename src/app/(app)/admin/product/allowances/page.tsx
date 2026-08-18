import { AllowancesTable } from "@/components/manufacture/allowances-table";
import { db } from "@/lib/db/kysely";

// ProductLayout above this page already does requireRole(["admin"]), and
// saveManufactureAllowance guards itself, so there is no guard here.

export const dynamic = "force-dynamic";

export const metadata = { title: "Allowances — Drapeworks CRM" };

// Fixed display order rather than alphabetical: alphabetical would put Blinds
// first, which reads oddly against the Curtains/Blinds/Mesh sibling tabs.
const ORDER = ["curtain", "blind", "mesh"] as const;

export default async function AllowancesPage() {
  const rows = await db
    .selectFrom("manufacture_allowances")
    .select(["product_line", "width_delta_cm", "height_delta_cm"])
    .execute();

  const byLine = new Map(rows.map((r) => [r.product_line, r]));
  const ordered = ORDER.map((line) => ({
    productLine: line,
    widthDeltaCm: byLine.get(line)?.width_delta_cm ?? null,
    heightDeltaCm: byLine.get(line)?.height_delta_cm ?? null,
  }));

  return <AllowancesTable rows={ordered} />;
}
