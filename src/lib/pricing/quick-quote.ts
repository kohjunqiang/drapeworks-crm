import type { ActiveCombo } from "@/lib/db/combos";
import type { CurtainPackageRow } from "@/lib/db/product-pricing-settings";
import { resolveWindowAddons, toCalcAddons } from "@/lib/orders/window-addons";
import { newCalculatorWindow, pricingCalculatorSchema, calculatorDefaults, type CalculatorRoom, type CalculatorValues, type CalculatorWindow } from "@/lib/validation/pricing-calculator";
import { computeQuote, marginBps, windowQuote, type CalcWindow } from "./calculator";
import { makePackageContext } from "./curtain-package-rules";
import type { CalcConfig } from "./order-quote";

export type QuickQuoteOption = {
  id: string; name: string; category: "Day" | "Night" | null; productLine: "curtain" | "blind";
  costRmbCents: number | null; saleSgdCents: number;
};
export type QuickQuoteData = { options: QuickQuoteOption[]; config: CalcConfig; packages: CurtainPackageRow[]; combos: ActiveCombo[] };
export type QuoteIssue = {
  roomId?: string; windowId?: string; message: string;
  severity: "pending" | "error";
  kind: "empty_rooms" | "missing_covering" | "missing_width" | "missing_selection" | "invalid_measurement" | "missing_cost" | "unavailable_selection" | "invalid_discount" | "invalid_installation" | "package_pricing";
};

/** Only clear Essential labels in the required curtain category are defaults.
 * Multiple eligible series remain unselected rather than choosing arbitrarily. */
export function essentialOptionId(options: readonly QuickQuoteOption[], category: "Day" | "Night"): string {
  const matches = options.filter((option) => {
    const name = /^essential(?:\s*\((day|night)\))?$/i.exec(option.name.trim());
    return option.productLine === "curtain" && option.category === category && name !== null &&
      (!name[1] || name[1].toLowerCase() === category.toLowerCase()) &&
      Number.isFinite(option.saleSgdCents) && option.saleSgdCents >= 0;
  });
  return matches.length === 1 ? matches[0].id : "";
}
const usesDay = (covering: CalculatorWindow["covering"]) => covering === "day" || covering === "both";
const usesNight = (covering: CalculatorWindow["covering"]) => covering === "night" || covering === "both";

/** Used by both Add room and Add another covering. Dimensions stay blank. */
export function newQuickQuoteWindow(id: string, options: readonly QuickQuoteOption[], covering: CalculatorWindow["covering"] = "both"): CalculatorWindow {
  const window = newCalculatorWindow(id, covering);
  return { ...window,
    dayId: usesDay(covering) ? essentialOptionId(options, "Day") : "",
    nightId: usesNight(covering) ? essentialOptionId(options, "Night") : "" };
}

export const PRESET_ROOMS = ["Living Room", "Master Bedroom", "Bedroom 1", "Bedroom 2", "Bedroom 3", "Master Toilet", "Common Toilet", "Kitchen", "Study Room", "Balcony", "Service Yard"];
export function newWorksheet(options: readonly QuickQuoteOption[]): CalculatorValues {
  return { ...calculatorDefaults, rooms: PRESET_ROOMS.map((label, index) => ({
    id: `preset-${index}`, label, preset: true,
    windows: [{ ...newQuickQuoteWindow(`preset-${index}-window`, options, label.includes("Toilet") ? "blind" : "both"), active: false }],
  })) };
}
export function editWorksheetWindow(window: CalculatorWindow, patch: Partial<CalculatorWindow>): CalculatorWindow {
  return { ...window, ...patch, active: true };
}
export function clearWorksheetRoom(room: CalculatorRoom, options: readonly QuickQuoteOption[]): CalculatorRoom {
  return { ...room, windows: [{ ...newQuickQuoteWindow(`${room.id}-window`, options, (room.preset ? ["preset-5", "preset-6"].includes(room.id) : room.label.includes("Toilet")) ? "blind" : "both"), active: false }] };
}
// Missing flags are legacy drafts: their existing coverings remain included.
export function activeCalculatorRooms(values: CalculatorValues): CalculatorRoom[] {
  return values.rooms.map((room) => ({ ...room, windows: room.windows.filter((window) => window.active !== false) }))
    .filter((room) => room.windows.length > 0 || (!room.preset && room.windows.length === 0));
}

/** Exact decimal parsing: reject partial junk, exponents and fractions of a cent. */
export function decimalCents(raw: string): number | null {
  if (!/^\d+(?:\.\d{0,2})?$/.test(raw.trim())) return null;
  const [whole, fraction = ""] = raw.trim().split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents <= 2147483647 ? cents : null;
}
export function measurement(raw: string): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  const value = Number(raw);
  return value > 0 && value <= 1000 ? value : null;
}
export function changeCovering(window: CalculatorWindow, covering: CalculatorWindow["covering"], options: readonly QuickQuoteOption[] = []): CalculatorWindow {
  return { ...window, covering, addonIds: [], comboId: "",
    dayId: usesDay(covering) ? window.dayId || (!usesDay(window.covering) ? essentialOptionId(options, "Day") : "") : "",
    nightId: usesNight(covering) ? window.nightId || (!usesNight(window.covering) ? essentialOptionId(options, "Night") : "") : "",
    blindId: covering === "blind" ? window.blindId : "" };
}
export function finalQuoteMetrics(calculatedCents: number, netCostCents: number, override: string | null, complete: boolean) {
  const cents = override === null ? calculatedCents : decimalCents(override);
  const valid = cents !== null && cents > 0;
  return { cents, valid, profitCents: complete && valid ? cents - netCostCents : null,
    margin: complete && valid ? marginBps(netCostCents, cents) : null };
}

export function quickQuote(values: CalculatorValues, data: QuickQuoteData) {
  const issues: QuoteIssue[] = [];
  const shape = pricingCalculatorSchema.safeParse(values);
  if (!shape.success) throw new Error("Invalid calculator input shape");
  const discountBps = decimalCents(values.discount);
  const extraCents = decimalCents(values.extraInstallation);
  if (discountBps === null || discountBps > 10000) issues.push({ severity: "error", kind: "invalid_discount", message: "Discount must be between 0 and 100%, with at most two decimal places." });
  if (extraCents === null) issues.push({ severity: "error", kind: "invalid_installation", message: "Additional installation must be a valid non-negative SGD amount." });
  const activeRooms = activeCalculatorRooms(values);
  if (!activeRooms.length) issues.push({ severity: "pending", kind: "empty_rooms", message: "Add a room to start your quote." });
  const windows: CalcWindow[] = activeRooms.flatMap((room, roomIndex) => {
    if (!room.windows.length) issues.push({ severity: "pending", kind: "missing_covering", roomId: room.id, message: `${room.label}: Add a covering to calculate.` });
    return room.windows.map((window, index) => {
      const originalIndex = values.rooms.find((original) => original.id === room.id)?.windows.findIndex((original) => original.id === window.id) ?? index;
      const at = `${room.label || `Room ${roomIndex + 1}`} · Window ${originalIndex + 1}`;
      const issue = (kind: QuoteIssue["kind"], message: string, severity: QuoteIssue["severity"] = "error") => issues.push({ severity, kind, roomId: room.id, windowId: window.id, message: `${at}: ${message}` });
      const widthCm = measurement(window.width);
      if (window.width.trim() === "") issue("missing_width", "Enter width to calculate.", "pending");
      else if (widthCm === null) issue("invalid_measurement", "Enter a width from 1 to 1000 cm (whole centimetres).");
      // Height does not price curtains/blinds in today's CRM. It is optional,
      // but an entered invalid height must never look accepted.
      if (window.height.trim() !== "" && measurement(window.height) === null) issue("invalid_measurement", "Height must be from 1 to 1000 cm (whole centimetres).");
      const price = (id: string, kind: "day" | "night" | "blind") => {
        if (!id) { issue("missing_selection", `Select ${kind === "blind" ? "blind type" : `${kind} fabric`} to calculate.`, "pending"); return null; }
        const option = data.options.find((p) => p.id === id && (kind === "blind" ? p.productLine === "blind" : p.productLine === "curtain" && p.category === (kind === "day" ? "Day" : "Night")));
        if (!option) { issue("unavailable_selection", `Selected ${kind === "blind" ? "blind" : `${kind} fabric`} is unavailable; select a priced ${kind === "blind" ? "blind" : `${kind} fabric`}.`); return null; }
        if (option.costRmbCents === null) issue("missing_cost", `${option.name} has no cost configured; margin is unavailable.`);
        return { costRmbCents: option.costRmbCents, saleSgdCents: option.saleSgdCents, label: option.name };
      };
      const covering = window.covering === "blind" ? "blind" : "curtain";
      const resolved = resolveWindowAddons(covering, widthCm, window.addonIds, [], data.config.addonCatalogue);
      for (const addon of resolved.filter((a) => a.selected)) if (addon.costRmbCents === null) issue("missing_cost", `${addon.label} has no cost configured; margin is unavailable.`);
      const combo = data.combos.find((c) => c.id === window.comboId);
      if (window.comboId && !combo && covering === "curtain") issue("unavailable_selection", "Selected combo is unavailable.");
      const common = { roomIndex, roomLabel: room.label, widthCm, noInstallation: window.noInstallation, covering,
        addons: toCalcAddons(resolved) } as const;
      return covering === "blind"
        ? { ...common, blindPrice: price(window.blindId, "blind") }
        : { ...common, dayPrice: window.covering !== "night" ? price(window.dayId, "day") : null,
          nightPrice: window.covering !== "day" ? price(window.nightId, "night") : null,
          dayTrackRequired: window.dayTrack, nightTrackRequired: window.nightTrack, comboPriceSgdCents: combo?.priceSgdCents ?? null };
    });
  });
  const selectedPackage = data.packages.find((p) => p.id === values.packageId);
  let packageContext = null;
  if (values.packageId) {
    if (!selectedPackage) issues.push({ severity: "error", kind: "unavailable_selection", message: "Selected curtain package is unavailable. Choose another pricing basis." });
    else {
      try { packageContext = makePackageContext(selectedPackage, values.packageTier, values.singleLayer, data.config.curtainRates); }
      catch { issues.push({ severity: "error", kind: "package_pricing", message: "Package pricing is incomplete. Review its pricing settings." }); }
    }
  }
  const quote = computeQuote(windows, data.config.assumptions, values.freight, extraCents ?? 0,
    discountBps !== null && discountBps <= 10000 ? discountBps : 0, packageContext);
  // Package diagnostics depend on complete room inputs. Do not turn a blank
  // width/selection into a second, red engine warning while entry is pending.
  if (!issues.some((issue) => issue.severity === "pending")) {
    for (const message of quote.pricingIssues ?? []) issues.push({ severity: "error", kind: "package_pricing", message });
  }
  const activeInputs = activeRooms.flatMap((room) => room.windows);
  const items = windows.map((window, index) => ({
    windowId: activeInputs[index].id,
    includedInPackage: packageContext !== null && window.covering === "curtain",
    subtotalCents: issues.some((issue) => issue.windowId === activeInputs[index].id) ? null : windowQuote(window, data.config.assumptions).saleSgdCents,
  }));
  return { quote, issues, complete: issues.length === 0, windows, packageContext, items,
    roomCount: activeRooms.length, coveringCount: windows.length };
}
