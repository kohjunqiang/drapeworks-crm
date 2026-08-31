import "server-only";

import { db } from "@/lib/db/kysely";
import type { AddonRule, CalcAddon } from "@/lib/orders/window-addons";

/**
 * Every add-on row, UNFILTERED — the resolver decides what to drop.
 *
 * Do not add `.where("is_active", "=", true)` here. The resolver keeps an
 * archived add-on that a window already carries, so it can be cleared
 * deliberately rather than vanishing; filtering at load time takes that choice
 * away and the next save's delete-then-insert makes the loss permanent.
 */
export async function loadAddonCatalogue(): Promise<AddonRule[]> {
  const rows = await db
    .selectFrom("pricing_addons")
    .select([
      "id",
      "key",
      "label",
      "cost_rmb_cents",
      "sale_sgd_cents",
      "basis",
      "applies_to",
      "auto_rule",
      "auto_width_over_cm",
      "is_active",
    ])
    // The only thing making the form's checkbox order stable across an admin
    // edit. Without it Postgres returns these in whatever order suits it.
    .orderBy("is_active", "desc")
    .orderBy("label", "asc")
    .execute();

  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    label: r.label,
    costRmbCents: r.cost_rmb_cents,
    saleSgdCents: r.sale_sgd_cents,
    basis: r.basis,
    appliesTo: r.applies_to,
    autoRule: r.auto_rule,
    autoWidthOverCm: r.auto_width_over_cm,
    isActive: r.is_active,
  }));
}

/** windowId → the add-on ids it currently carries. */
export async function loadWindowAddonIds(
  windowIds: readonly string[],
): Promise<Map<string, string[]>> {
  const byWindow = new Map<string, string[]>();
  if (windowIds.length === 0) return byWindow;

  const rows = await db
    .selectFrom("window_addons")
    .select(["window_id", "addon_id"])
    .where("window_id", "in", windowIds)
    .execute();

  for (const r of rows) {
    byWindow.set(r.window_id, [
      ...(byWindow.get(r.window_id) ?? []),
      r.addon_id,
    ]);
  }
  return byWindow;
}

/**
 * windowId → the add-ons it carries, priced, for the calculator.
 *
 * Reads the join rows as written rather than re-running the resolver: a saved
 * order's quote must reproduce what was agreed, not what today's rules would
 * decide. Prices are read live, so an admin's correction still propagates and
 * the staleness machinery keeps its meaning.
 */
export async function loadWindowCalcAddons(
  orderIds: readonly string[],
): Promise<Map<string, CalcAddon[]>> {
  const byWindow = new Map<string, CalcAddon[]>();
  if (orderIds.length === 0) return byWindow;

  const rows = await db
    .selectFrom("window_addons")
    .innerJoin("windows", "windows.id", "window_addons.window_id")
    .innerJoin("rooms", "rooms.id", "windows.room_id")
    .innerJoin("pricing_addons", "pricing_addons.id", "window_addons.addon_id")
    .select([
      "window_addons.window_id as window_id",
      "pricing_addons.label as label",
      "pricing_addons.key as key",
      "pricing_addons.cost_rmb_cents as cost_rmb_cents",
      "pricing_addons.sale_sgd_cents as sale_sgd_cents",
      "pricing_addons.basis as basis",
    ])
    .where("rooms.order_id", "in", orderIds)
    .orderBy("pricing_addons.label", "asc")
    .execute();

  for (const r of rows) {
    byWindow.set(r.window_id, [
      ...(byWindow.get(r.window_id) ?? []),
      {
        key: r.key,
        label: r.label,
        costRmbCents: r.cost_rmb_cents,
        saleSgdCents: r.sale_sgd_cents,
        basis: r.basis,
      },
    ]);
  }
  return byWindow;
}
