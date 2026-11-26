import "server-only";
import { db } from "./kysely";
import type { QuickQuoteOption } from "@/lib/pricing/quick-quote";

/** Price by series, without requiring a fabric code or signing catalogue photos. */
export async function loadQuickQuoteOptions(): Promise<QuickQuoteOption[]> {
  const rows = await db.selectFrom("curtain_series as s")
    .innerJoin("curtain_types as t", "t.series_id", "s.id")
    .select(["s.id", "s.name", "s.product_line", "s.cost_rmb_cents", "s.sale_sgd_cents", "t.category"])
    .where("s.is_active", "=", true).where("t.status", "=", "Active")
    .where("s.sale_sgd_cents", "is not", null)
    .distinct().orderBy("s.name", "asc").execute();
  return rows.filter((r) => r.sale_sgd_cents !== null).map((r) => ({
    id: `${r.id}:${r.category ?? "blind"}`, name: r.name, category: r.category,
    productLine: r.product_line, costRmbCents: r.cost_rmb_cents, saleSgdCents: r.sale_sgd_cents!,
  }));
}
