import { z } from "zod";
import type { CalcWindow } from "./calculator";
import { computePackageQuote, type PackageAdjustmentInput } from "./package-calculator";

export const CURTAIN_RATE_KEYS = [
  "ultimate_from_essential_sgd", "ultimate_from_pls_sgd",
  "zen_default_sgd", "zen_4m_sgd", "zen_5m_sgd",
  "s_fold_3m_sgd", "s_fold_4m_sgd", "s_fold_above_4m_sgd",
  "remove_day_sgd", "remove_essential_sgd", "remove_pls_sgd",
  "add_day_sgd", "add_essential_sgd", "add_pls_sgd",
  "blackout_per_m_sgd", "slim_single_per_m_sgd", "slim_double_per_m_sgd",
] as const;
export type CurtainRateKey = typeof CURTAIN_RATE_KEYS[number];
/** All amounts are integer SGD cents, even though settings keys retain _sgd. */
export type CurtainRates = Record<CurtainRateKey, number | null>;
const cents = z.number().int().min(0).max(2147483647);
export const packageContextSchema = z.object({
  version: z.literal(1),
  id: z.string().uuid(), name: z.string(),
  packageType: z.enum(["single", "double"]),
  roomSetCount: z.number().int().positive(),
  tier: z.enum(["essential", "tier2"]),
  singleLayer: z.enum(["day", "night"]),
  baseCents: cents, tier2UpgradeCents: cents.nullable(),
  roomUpgradeCents: cents.nullable(), roomDowngradeCents: cents.nullable(),
  rates: z.record(z.enum(CURTAIN_RATE_KEYS), cents.nullable()),
});
export type CurtainPackageContext = z.infer<typeof packageContextSchema>;
export type SavedPackageSnapshot = {
  id: string; tier: "essential" | "tier2"; saleSgdCents: number;
  rules?: CurtainPackageContext | null;
};
export function makePackageContext(
  item: { id: string; name: string; packageType: "single" | "double"; roomSetCount: number; priceSgd: string; tier2UpgradeSgd: string; roomTier2UpgradeSgd: string; roomTier2DowngradeSgd: string },
  tier: "essential" | "tier2", singleLayer: "day" | "night", rates: CurtainRates,
): CurtainPackageContext {
  const price = (value: string) => value.trim() === "" ? null : Math.round(Number(value) * 100);
  return packageContextSchema.parse({ version: 1, id: item.id, name: item.name, packageType: item.packageType,
    roomSetCount: item.roomSetCount, tier, singleLayer, baseCents: price(item.priceSgd),
    tier2UpgradeCents: price(item.tier2UpgradeSgd), roomUpgradeCents: price(item.roomTier2UpgradeSgd),
    roomDowngradeCents: price(item.roomTier2DowngradeSgd), rates });
}
export function readPackageContext(value: unknown): CurtainPackageContext | null {
  if (value == null) return null;
  // Corrupt snapshots must never silently fall back to today's rates.
  return packageContextSchema.parse(value);
}
/** Canonical across PostgreSQL JSONB key ordering and client-side objects. */
export function packagePricingSignature(context: CurtainPackageContext): string {
  return JSON.stringify([context.version, context.id, context.name, context.packageType,
    context.roomSetCount, context.tier, context.singleLayer, context.baseCents,
    context.tier2UpgradeCents, context.roomUpgradeCents, context.roomDowngradeCents,
    ...CURTAIN_RATE_KEYS.map((key) => context.rates[key])]);
}

export function curtainSeriesTier(name: string | null | undefined) {
  const normalized = (name ?? "").trim().toLowerCase();
  const matches = ["essential", "performance", "luxe", "lux", "signature", "ultimate", "zen"]
    .filter((tier) => new RegExp(`^${tier}(?:$|[\\s(_-])`).test(normalized));
  if (matches.length !== 1) return "unknown";
  const tier = matches[0];
  return tier === "performance" || tier === "luxe" || tier === "lux" || tier === "signature"
    ? "tier2" : tier as "essential" | "ultimate" | "zen";
}
export function packageAddonKind(label: string, key?: string): "sfold" | "blackout" | "slim" | null {
  const name = (key ?? label).toLowerCase().replace(/[\s_-]/g, "");
  if (name === "sfold") return "sfold";
  if (name === "blackout") return "blackout";
  if (name === "slimtracks" || name === "slimtrack") return "slim";
  return null;
}
export function zenRateKey(widthCm: number): CurtainRateKey {
  return widthCm < 400 ? "zen_default_sgd" : widthCm < 500 ? "zen_4m_sgd" : "zen_5m_sgd";
}
export function sFoldRateKey(widthCm: number): CurtainRateKey {
  return widthCm < 400 ? "s_fold_3m_sgd" : widthCm === 400 ? "s_fold_4m_sgd" : "s_fold_above_4m_sgd";
}

/** One resolver for previews, save validation, saved quotes and stale checks. */
export function resolveCurtainPackageQuote(windows: readonly CalcWindow[], context: CurtainPackageContext) {
  const issues: string[] = [];
  const adjustments: PackageAdjustmentInput[] = [];
  const add = (key: string, label: string, amount: number | null, direction: "charge" | "credit" = "charge", widthCm?: number) => {
    if (amount == null) { issues.push(`${label}: price not configured`); return; }
    adjustments.push({ key, label, direction, amountSgdCents: amount,
      basis: widthCm == null ? "per_room" : "per_metre", roomCount: 1, widthCm });
  };
  if (context.tier === "tier2") {
    if (context.tier2UpgradeCents == null) issues.push("Whole-package Tier 2 price not configured");
    else adjustments.push({ key: "tier2", label: "Whole-package Tier 2", direction: "charge", basis: "whole_package", amountSgdCents: context.tier2UpgradeCents });
  }
  const rooms = new Map<number, CalcWindow[]>();
  for (const [index, window] of windows.entries()) {
    if (window.blindPrice || window.covering === "blind") continue;
    const key = window.roomIndex ?? index;
    rooms.set(key, [...(rooms.get(key) ?? []), window]);
  }
  if (rooms.size !== context.roomSetCount) issues.push(`Package requires ${context.roomSetCount} curtain room sets; currently ${rooms.size}`);
  for (const [index, room] of rooms) {
    const label = room[0].roomLabel || `Room ${index + 1}`;
    const width = room.reduce((sum, window) => sum + (window.widthCm ?? 0), 0);
    if (room.some((window) => !window.widthCm || window.widthCm <= 0)) {
      issues.push(`${label}: enter every curtain window width`); continue;
    }
    if (room.some((window) => window.comboPriceSgdCents != null)) issues.push(`${label}: remove the old window combo before using a package`);
    const group = (window: CalcWindow, layer: "day" | "night") => {
      const price = layer === "day" ? window.dayPrice : window.nightPrice;
      if (!price) return "none";
      const tier = curtainSeriesTier(price.label);
      if (layer === "day" && tier === "tier2" && !/^signature(?:$|[\s(_-])/i.test((price.label ?? "").trim())) return "unknown";
      return tier;
    };
    const day = group(room[0], "day");
    const night = group(room[0], "night");
    if (day === "none" && night === "none") {
      issues.push(`${label}: select at least one curtain layer; an empty room is not a confirmed layer removal`); continue;
    }
    if (room.some((window) => group(window, "day") !== day || group(window, "night") !== night)) {
      issues.push(`${label}: use the same layer/tier configuration across this room's windows, or split them into separate room sets`); continue;
    }
    if (day === "unknown" || night === "unknown" || day === "ultimate" || night === "zen") {
      issues.push(`${label}: unrecognised or incompatible day/night series; check the series name`); continue;
    }
    const includedDay = context.packageType === "double" || context.singleLayer === "day";
    const includedNight = context.packageType === "double" || context.singleLayer === "night";
    const line = (key: string, title: string, rate: CurtainRateKey, credit = false, measured?: number) =>
      add(`${index}:${key}`, `${label} · ${title}`, context.rates[rate], credit ? "credit" : "charge", measured);

    if (includedDay && day === "none") line("remove-day", "Remove Day", "remove_day_sgd", true);
    if (!includedDay && day !== "none") line("add-day", "Add Day", "add_day_sgd");
    // Essential and Signature are both included Groupbuy day choices. Zen is
    // the only day fabric upgrade on the supplied cheat sheet.
    if (day === "zen") line("zen", `Zen (${(width / 100).toFixed(2)}m)`, zenRateKey(width));
    if (includedNight && night === "none") line("remove-night", "Remove Night", context.tier === "essential" ? "remove_essential_sgd" : "remove_pls_sgd", true);
    if (!includedNight && night !== "none") {
      line("add-night", "Add Night", night === "tier2" ? "add_pls_sgd" : "add_essential_sgd");
      if (night === "ultimate") line("ultimate", "Essential → Ultimate", "ultimate_from_essential_sgd");
    } else if (includedNight && night !== "none") {
      if (night === "ultimate") line("ultimate", `${context.tier === "essential" ? "Essential" : "Tier 2"} → Ultimate`, context.tier === "essential" ? "ultimate_from_essential_sgd" : "ultimate_from_pls_sgd");
      if (context.tier === "essential" && night === "tier2") add(`${index}:upgrade`, `${label} · Essential → Tier 2`, context.roomUpgradeCents);
      if (context.tier === "tier2" && night === "essential") add(`${index}:downgrade`, `${label} · Tier 2 → Essential`, context.roomDowngradeCents, "credit");
    }
    for (const kind of ["sfold", "blackout", "slim"] as const) {
      const selected = room.filter((window) => window.addons?.some((addon) => packageAddonKind(addon.label, addon.key) === kind));
      if (selected.length === 0) continue;
      if (day === "none" && night === "none") { issues.push(`${label}: remove extras from a room with no curtain layers`); continue; }
      const selectedWidth = selected.reduce((sum, window) => sum + (window.widthCm ?? 0), 0);
      if (kind === "sfold") line(kind, `S-fold (${(selectedWidth / 100).toFixed(2)}m)`, sFoldRateKey(selectedWidth));
      if (kind === "blackout") line(kind, "Blackout", "blackout_per_m_sgd", false, selectedWidth);
      if (kind === "slim") line(kind, "Slim track", day !== "none" && night !== "none" ? "slim_double_per_m_sgd" : "slim_single_per_m_sgd", false, selectedWidth);
    }
  }
  try {
    const quote = computePackageQuote(context.name, context.baseCents, adjustments);
    return { ...quote, issues };
  } catch (error) {
    issues.push(error instanceof Error ? error.message : "Invalid package price");
    return { totalSgdCents: 0, lines: [], issues };
  }
}
