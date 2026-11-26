import { describe, expect, it } from "vitest";
import { linksForRole } from "@/components/nav/links";
import { calculatorDefaults, newCalculatorWindow, type CalculatorValues } from "@/lib/validation/pricing-calculator";
import { computeQuote, type CalcAssumptions } from "./calculator";
import { CURTAIN_RATE_KEYS, makePackageContext, type CurtainRates } from "./curtain-package-rules";
import { changeCovering, decimalCents, finalQuoteMetrics, quickQuote, type QuickQuoteData } from "./quick-quote";
const assumptions: CalcAssumptions = {
  fxSgdToRmb: 53000, gstBps: 900, otherCostBps: 1000, groupbuyDiscountBps: 1500, styleMultiplier: 20000,
  handymanSingleSgdCents: 6000, handymanDoubleSgdCents: 10000, handymanBlindsSgdCents: 8000,
  seaFreightRmbCentsPerM3: 40000, airFreightRateBps: 6000, airFreightFloorRmbCents: 50000,
  airFreightCapRmbCents: 140000, trackCostRmbCentsPerM: 2500,
};
const rates = Object.fromEntries(CURTAIN_RATE_KEYS.map((key) => [key, 5000])) as CurtainRates;
const data: QuickQuoteData = {
  options: [
    { id: "day", name: "Essential", category: "Day", productLine: "curtain", costRmbCents: 2500, saleSgdCents: 6000 },
    { id: "night", name: "Performance", category: "Night", productLine: "curtain", costRmbCents: 4500, saleSgdCents: 12000 },
    { id: "blind", name: "Roller", category: null, productLine: "blind", costRmbCents: 5000, saleSgdCents: 15000 },
  ],
  config: { assumptions, curtainRates: rates, minMarginBps: 3500, minMarginCarousellBps: 3000,
    addonCatalogue: [{ id: "width-addon", key: "extra_shipping", label: "Wide blind", costRmbCents: 1000, saleSgdCents: 2000,
      basis: "per_unit", appliesTo: "blind", autoRule: "width_over", autoWidthOverCm: 200, isActive: true }] },
  packages: [{ id: "11111111-1111-4111-8111-111111111111", name: "Three-room package", propertyTierId: "tier", propertyTierLabel: "3 rooms", roomSetCount: 3,
    packageType: "double", baseTier: "essential", priceSgd: "1800.00", tier2UpgradeSgd: "300.00", roomTier2UpgradeSgd: "100.00", roomTier2DowngradeSgd: "100.00", isActive: true }],
  combos: [{ id: "combo", name: "Bundle", priceSgdCents: 80000 }],
};
function values(): CalculatorValues {
  return { ...calculatorDefaults, rooms: [{ id: "living", label: "Living Room", windows: [{ ...newCalculatorWindow("window"), width: "300", dayId: "day", nightId: "night" }] }] };
}
describe("quick quote adapter", () => {
  it("matches existing whole-home curtain/blind engine to the cent including freight, tracks, installation, automatic add-ons and discount", () => {
    const input = values(); input.discount = "7.25"; input.extraInstallation = "18.30"; input.freight = "sea";
    input.rooms[0].windows[0].dayTrack = false;
    input.rooms.push({ id: "bedroom", label: "Bedroom", windows: [{ ...newCalculatorWindow("blind-window", "blind"), width: "245", blindId: "blind", noInstallation: true }] });
    const actual = quickQuote(input, data);
    const expected = computeQuote([
      { roomIndex: 0, roomLabel: "Living Room", covering: "curtain", widthCm: 300, noInstallation: false,
        dayPrice: { costRmbCents: 2500, saleSgdCents: 6000, label: "Essential" }, nightPrice: { costRmbCents: 4500, saleSgdCents: 12000, label: "Performance" }, dayTrackRequired: false, nightTrackRequired: true, addons: [], comboPriceSgdCents: null },
      { roomIndex: 1, roomLabel: "Bedroom", covering: "blind", widthCm: 245, noInstallation: true,
        blindPrice: { costRmbCents: 5000, saleSgdCents: 15000, label: "Roller" }, addons: [{ key: "extra_shipping", label: "Wide blind", costRmbCents: 1000, saleSgdCents: 2000, basis: "per_unit" }] },
    ], assumptions, "sea", 1830, 725);
    expect(actual.complete).toBe(true); expect(actual.quote).toEqual(expected);
  });
  it("uses width-based blinds; entered heights do not change price", () => {
    const input = values(); input.rooms[0].windows[0] = { ...newCalculatorWindow("w", "blind"), width: "200", height: "100", blindId: "blind" };
    const first = quickQuote(input, data); input.rooms[0].windows[0].height = "300";
    expect(quickQuote(input, data).quote).toEqual(first.quote);
  });
  it("crosses the current automatic add-on threshold, not an Excel threshold", () => {
    const input = values(); input.rooms[0].windows[0] = { ...newCalculatorWindow("w", "blind"), width: "200", blindId: "blind" };
    expect(quickQuote(input, data).windows[0].addons).toEqual([]);
    input.rooms[0].windows[0].width = "201";
    expect(quickQuote(input, data).windows[0].addons).toHaveLength(1);
  });
  it("never carries curtain/combo/add-on choices into a blind or a removed layer", () => {
    const window = { ...values().rooms[0].windows[0], comboId: "combo", addonIds: ["width-addon"] };
    const blind = changeCovering(window, "blind");
    expect(blind).toMatchObject({ dayId: "", nightId: "", comboId: "", addonIds: [] });
    const day = changeCovering(window, "day"); expect(day.nightId).toBe("");
    expect(quickQuote({ ...values(), rooms: [{ id: "r", label: "Room", windows: [day] }] }, data).windows[0].nightPrice).toBeNull();
  });
  it("matches package rules and does not add another groupbuy discount", () => {
    const input = values(); input.packageId = data.packages[0].id;
    input.rooms = [0, 1, 2].map((i) => ({ ...input.rooms[0], id: `room-${i}`, label: `Room ${i + 1}`, windows: input.rooms[0].windows.map((w) => ({ ...w, id: `window-${i}` })) }));
    const actual = quickQuote(input, data);
    const expected = computeQuote(actual.windows, assumptions, "air", 0, 0, makePackageContext(data.packages[0], "essential", "night", rates));
    expect(actual.complete).toBe(true); expect(actual.quote).toEqual(expected);
    expect(actual.quote.groupbuySgdCents).toBe(actual.quote.discountedSaleSgdCents);
  });
  it("reports unresolved package rates without showing a complete quote", () => {
    const input = values(); input.packageId = data.packages[0].id;
    input.rooms = [0, 1, 2].map((i) => ({ ...input.rooms[0], id: `room-${i}`, label: `Room ${i + 1}`, windows: input.rooms[0].windows.map((w) => ({ ...w, id: `window-${i}` })) }));
    const incomplete = { ...data, packages: [{ ...data.packages[0], roomTier2UpgradeSgd: "" }] };
    const result = quickQuote(input, incomplete); expect(result.complete).toBe(false); expect(result.issues.length).toBeGreaterThan(0);
  });
  it("names the incomplete room and withholds profit/margin for missing product cost", () => {
    const missingCost = { ...data, options: data.options.map((p) => p.id === "night" ? { ...p, costRmbCents: null } : p) };
    const result = quickQuote(values(), missingCost);
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ roomId: "living", message: expect.stringContaining("Living Room") })]));
    expect(finalQuoteMetrics(result.quote.discountedSaleSgdCents, result.quote.netCostSgdCents, "2200", result.complete)).toMatchObject({ profitCents: null, margin: null });
  });
  it.each(["", "0", "-1", "1.5", "1001", "Infinity"])("rejects invalid width %s", (width) => {
    const input = values(); input.rooms[0].windows[0].width = width; expect(quickQuote(input, data).complete).toBe(false);
  });
  it("permits omitted height but rejects a malformed entered height", () => {
    const input = values(); expect(quickQuote(input, data).complete).toBe(true);
    input.rooms[0].windows[0].height = "-1"; expect(quickQuote(input, data).complete).toBe(false);
  });
  it.each(["", "-1", "101", "5x", "0.001"])("rejects invalid discounts %s", (discount) => {
    expect(quickQuote({ ...values(), discount }, data).complete).toBe(false);
  });
  it("does not treat the wrong covering's option as a valid selection", () => {
    const input = values(); input.rooms[0].windows[0].dayId = "blind";
    expect(quickQuote(input, data).issues.some((i) => i.message.includes("priced day fabric"))).toBe(true);
  });
});
describe("editable final quote", () => {
  it.each(["", "0", "-10", "Infinity", "2e3", "2000x", "1.001"])("does not fall back to calculated when manual value is %s", (raw) => {
    const result = finalQuoteMetrics(240000, 90000, raw, true);
    expect(result.valid).toBe(false); expect(result.profitCents).toBeNull(); expect(result.margin).toBeNull();
  });
  it("preserves manual price across cost/discount changes and restores current calculation explicitly", () => {
    expect(finalQuoteMetrics(240000, 90000, "2200", true)).toMatchObject({ cents: 220000, profitCents: 130000, margin: 5909 });
    expect(finalQuoteMetrics(270000, 100000, "2200", true)).toMatchObject({ cents: 220000, profitCents: 120000, margin: 5455 });
    expect(finalQuoteMetrics(270000, 100000, null, true)).toMatchObject({ cents: 270000, profitCents: 170000, margin: 6296 });
  });
  it("keeps decimal typing exact, accepts trailing dot, and rejects unsafe/overprecision values", () => {
    expect(decimalCents("12.")).toBe(1200); expect(decimalCents("12.01")).toBe(1201);
    expect(decimalCents("0.29")).toBe(29); expect(decimalCents("21474836.48")).toBeNull();
  });
  it("remains reachable in consultant/admin menus, never ops", () => {
    for (const role of ["admin", "consultant"] as const) expect(linksForRole(role).some((l) => l.href === "/pricing-calculator")).toBe(true);
    expect(linksForRole("ops").some((l) => l.href === "/pricing-calculator")).toBe(false);
  });
});
