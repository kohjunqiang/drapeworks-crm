import "server-only";

import { db } from "@/lib/db/kysely";
import { centsToDisplay } from "@/lib/money";

// Admin settings row (all combos, active + archived) for the management list,
// with the chosen day/night series ids (advisory) + a decimal price string.
export type ComboRow = {
  id: string;
  name: string;
  day_series_id: string | null;
  night_series_id: string | null;
  price_sgd: string; // decimal string for the edit form
  is_active: boolean;
};

export async function loadCombosForSettings(): Promise<ComboRow[]> {
  const rows = await db
    .selectFrom("pricing_combos")
    .select([
      "id",
      "name",
      "day_series_id",
      "night_series_id",
      "price_sgd_cents",
      "is_active",
    ])
    .orderBy("is_active", "desc")
    .orderBy("name", "asc")
    .execute();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    day_series_id: r.day_series_id,
    night_series_id: r.night_series_id,
    price_sgd: centsToDisplay(r.price_sgd_cents),
    is_active: r.is_active,
  }));
}

// Active combos only — the per-window combo picker + live-quote price lookup.
export type ActiveCombo = {
  id: string;
  name: string;
  priceSgdCents: number;
};

export async function loadActiveCombos(): Promise<ActiveCombo[]> {
  const rows = await db
    .selectFrom("pricing_combos")
    .select(["id", "name", "price_sgd_cents"])
    .where("is_active", "=", true)
    .orderBy("name", "asc")
    .execute();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    priceSgdCents: r.price_sgd_cents,
  }));
}
