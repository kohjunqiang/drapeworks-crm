import type { ActiveCombo } from "@/lib/db/combos";
import type { CurtainPackageRow } from "@/lib/db/product-pricing-settings";
import { resolveWindowAddons, toCalcAddons } from "@/lib/orders/window-addons";
import { pricingCalculatorSchema, type CalculatorValues, type CalculatorWindow } from "@/lib/validation/pricing-calculator";
import { computeQuote, marginBps, type CalcWindow } from "./calculator";
import { makePackageContext } from "./curtain-package-rules";
import type { CalcConfig } from "./order-quote";

export type QuickQuoteOption = {
  id: string; name: string; category: "Day" | "Night" | null; productLine: "curtain" | "blind";
  costRmbCents: number | null; saleSgdCents: number;
};
export type QuickQuoteData = { options: QuickQuoteOption[]; config: CalcConfig; packages: CurtainPackageRow[]; combos: ActiveCombo[] };
export type QuoteIssue = { roomId?: string; windowId?: string; message: string };

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
export function changeCovering(window: CalculatorWindow, covering: CalculatorWindow["covering"]): CalculatorWindow {
  return { ...window, covering, addonIds: [], comboId: "",
    dayId: covering === "day" || covering === "both" ? window.dayId : "",
    nightId: covering === "night" || covering === "both" ? window.nightId : "",
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
  if (discountBps === null || discountBps > 10000) issues.push({ message: "Discount must be between 0 and 100%, with at most two decimal places." });
  if (extraCents === null) issues.push({ message: "Additional installation must be a valid non-negative SGD amount." });
  if (!values.rooms.length) issues.push({ message: "Add a room to start your quote." });
  const windows: CalcWindow[] = values.rooms.flatMap((room, roomIndex) => {
    if (!room.windows.length) issues.push({ roomId: room.id, message: `${room.label}: add a covering.` });
    return room.windows.map((window, index) => {
      const at = `${room.label || `Room ${roomIndex + 1}`} · Window ${index + 1}`;
      const issue = (message: string) => issues.push({ roomId: room.id, windowId: window.id, message: `${at}: ${message}` });
      const widthCm = measurement(window.width);
      if (widthCm === null) issue("enter a width from 1 to 1000 cm (whole centimetres).");
      // Height does not price curtains/blinds in today's CRM. It is optional,
      // but an entered invalid height must never look accepted.
      if (window.height !== "" && measurement(window.height) === null) issue("height must be from 1 to 1000 cm (whole centimetres).");
      const price = (id: string, kind: "day" | "night" | "blind") => {
        const option = data.options.find((p) => p.id === id && (kind === "blind" ? p.productLine === "blind" : p.productLine === "curtain" && p.category === (kind === "day" ? "Day" : "Night")));
        if (!option) { issue(`select a priced ${kind === "blind" ? "blind" : `${kind} fabric`}.`); return null; }
        if (option.costRmbCents === null) issue(`${option.name} has no cost configured; margin is unavailable.`);
        return { costRmbCents: option.costRmbCents, saleSgdCents: option.saleSgdCents, label: option.name };
      };
      const covering = window.covering === "blind" ? "blind" : "curtain";
      const resolved = resolveWindowAddons(covering, widthCm, window.addonIds, [], data.config.addonCatalogue);
      for (const addon of resolved.filter((a) => a.selected)) if (addon.costRmbCents === null) issue(`${addon.label} has no cost configured; margin is unavailable.`);
      const combo = data.combos.find((c) => c.id === window.comboId);
      if (window.comboId && !combo && covering === "curtain") issue("selected combo is unavailable.");
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
    if (!selectedPackage) issues.push({ message: "Selected curtain package is unavailable. Choose another pricing basis." });
    else {
      try { packageContext = makePackageContext(selectedPackage, values.packageTier, values.singleLayer, data.config.curtainRates); }
      catch { issues.push({ message: "Package pricing is incomplete. Review its pricing settings." }); }
    }
  }
  const quote = computeQuote(windows, data.config.assumptions, values.freight, extraCents ?? 0,
    discountBps !== null && discountBps <= 10000 ? discountBps : 0, packageContext);
  for (const message of quote.pricingIssues ?? []) issues.push({ message });
  return { quote, issues, complete: issues.length === 0, windows, packageContext };
}
