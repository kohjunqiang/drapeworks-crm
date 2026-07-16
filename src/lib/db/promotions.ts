import "server-only";

import { db } from "@/lib/db/kysely";

// Admin settings row (all tiers, active + archived) for the management list.
export type PromotionRow = {
  id: string;
  name: string;
  discountPct: string; // e.g. "15" — human units for the edit form
  is_active: boolean;
};

export async function loadPromotionsForSettings(): Promise<PromotionRow[]> {
  const rows = await db
    .selectFrom("promotions")
    .select(["id", "name", "discount_bps", "is_active"])
    .orderBy("is_active", "desc")
    .orderBy("name", "asc")
    .execute();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    discountPct: (r.discount_bps / 100).toString(),
    is_active: r.is_active,
  }));
}

// Active tiers only — the consultant's promotion picker on the form.
export type ActivePromotion = {
  id: string;
  name: string;
  discount_bps: number;
};

export async function loadActivePromotions(): Promise<ActivePromotion[]> {
  return db
    .selectFrom("promotions")
    .select(["id", "name", "discount_bps"])
    .where("is_active", "=", true)
    .orderBy("name", "asc")
    .execute();
}
