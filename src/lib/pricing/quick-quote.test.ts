import { describe, expect, it } from "vitest";
import { linksForRole } from "@/components/nav/links";
import { calculatorDefaults, newCalculatorWindow, type CalculatorValues } from "@/lib/validation/pricing-calculator";
import { computeQuote, windowQuote, type CalcAssumptions } from "./calculator";
import { CURTAIN_RATE_KEYS, makePackageContext, type CurtainRates } from "./curtain-package-rules";
import { newWorksheet, editWorksheetWindow, clearWorksheetRoom, changeCovering, decimalCents, essentialOptionId, finalQuoteMetrics, newQuickQuoteWindow, quickQuote, type QuickQuoteData } from "./quick-quote";
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


describe("quick-entry defaults and neutral pending inputs", () => {
  const options = [
    { ...data.options[0], id: "essential-day", name: "Essential (Day)" },
    { ...data.options[1], id: "essential-night", name: "Essential" },
    data.options[1], data.options[2],
  ];
  it("shares Essential defaults for new rooms and added coverings while dimensions stay blank", () => {
    for (const id of ["new-room-window", "added-covering"]) {
      expect(newQuickQuoteWindow(id, options)).toMatchObject({ id, dayId: "essential-day", nightId: "essential-night", width: "", height: "" });
    }
    expect(newQuickQuoteWindow("day", options, "day")).toMatchObject({ dayId: "essential-day", nightId: "" });
    expect(newQuickQuoteWindow("night", options, "night")).toMatchObject({ dayId: "", nightId: "essential-night" });
    expect(newQuickQuoteWindow("blind", options, "blind")).toMatchObject({ dayId: "", nightId: "", blindId: "", width: "", height: "" });
  });
  it("matches only clear priced Essential labels in the right category and leaves ambiguity blank", () => {
    expect(essentialOptionId(options, "Day")).toBe("essential-day");
    expect(essentialOptionId(options, "Night")).toBe("essential-night");
    expect(essentialOptionId([...options, { ...options[0], id: "other-essential" }], "Day")).toBe("");
    expect(essentialOptionId([{ ...options[0], name: "Essential Plus" }], "Day")).toBe("");
    expect(essentialOptionId([{ ...options[0], name: "Essential (Night)" }], "Day")).toBe("");
    expect(essentialOptionId([{ ...options[0], saleSgdCents: Number.NaN }], "Day")).toBe("");
    expect(essentialOptionId([data.options[2]], "Day")).toBe("");
  });
  it("defaults only newly introduced blank layers without overwriting active choices or intentional clearing", () => {
    const window = { ...newCalculatorWindow("w", "night"), nightId: "night", width: "321", height: "250" };
    const both = changeCovering(window, "both", options);
    expect(both).toMatchObject({ dayId: "essential-day", nightId: "night", width: "321", height: "250" });
    expect(changeCovering({ ...both, dayId: "" }, "day", options).dayId).toBe("");
    expect(changeCovering({ ...both, nightId: "" }, "both", options).nightId).toBe("");
    expect(window).toMatchObject({ dayId: "", nightId: "night", width: "321" });
  });
  it("classifies blank/cleared width and required selections as pending and withholds totals", () => {
    const input = values(); input.rooms[0].windows[0] = newQuickQuoteWindow("w", options);
    const fresh = quickQuote(input, { ...data, options });
    expect(fresh.complete).toBe(false); expect(fresh.issues).toEqual([expect.objectContaining({ kind: "missing_width", severity: "pending" })]);
    expect(finalQuoteMetrics(fresh.quote.discountedSaleSgdCents, fresh.quote.netCostSgdCents, "2200", fresh.complete)).toMatchObject({ profitCents: null, margin: null });
    input.rooms[0].windows[0].dayId = "";
    expect(quickQuote(input, { ...data, options }).issues).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "missing_selection", severity: "pending" })]));
    input.rooms[0].windows[0] = { ...newQuickQuoteWindow("b", options, "blind"), width: "300" };
    expect(quickQuote(input, { ...data, options }).issues).toEqual([expect.objectContaining({ kind: "missing_selection", severity: "pending", message: expect.stringContaining("Select blind type to calculate") })]);
  });
  it.each(["0", "-1", "abc", "300.5", "1001"])("keeps nonblank invalid width %s an error", (width) => {
    const input = values(); input.rooms[0].windows[0].width = width;
    expect(quickQuote(input, data).issues).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "invalid_measurement", severity: "error" })]));
  });
  it("keeps invalid height, missing cost and stale selections as errors", () => {
    const input = values(); input.rooms[0].windows[0].height = "0"; input.rooms[0].windows[0].dayId = "removed";
    const missingCost = { ...data, options: data.options.map((p) => p.id === "night" ? { ...p, costRmbCents: null } : p) };
    expect(quickQuote(input, missingCost).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "invalid_measurement", severity: "error" }),
      expect.objectContaining({ kind: "unavailable_selection", severity: "error" }),
      expect.objectContaining({ kind: "missing_cost", severity: "error" }),
    ]));
  });
  it("does not duplicate blank package width as a red engine diagnostic", () => {
    const input = values(); input.packageId = data.packages[0].id; input.rooms[0].windows[0].width = "";
    const result = quickQuote(input, data); expect(result.complete).toBe(false);
    expect(result.issues.every((issue) => issue.severity === "pending")).toBe(true);
  });
});

describe("worksheet inclusion and item pricing", () => {
  it("starts all eleven preset rooms untouched with blank dimensions and no quote contributions", () => {
    const input = newWorksheet(data.options);
    expect(input.rooms).toHaveLength(11);
    expect(input.rooms.slice(0, 5).map((room) => room.label)).toEqual(["Living Room", "Master Bedroom", "Bedroom 1", "Bedroom 2", "Bedroom 3"]);
    expect(input.rooms.every((room) => room.windows.every((window) => window.active === false && window.width === "" && window.height === ""))).toBe(true);
    expect(input.rooms[5].windows[0]).toMatchObject({ covering: "blind", blindId: "" });
    const result = quickQuote(input, data);
    expect(result).toMatchObject({ roomCount: 0, coveringCount: 0, complete: false, windows: [], items: [] });
    expect(result.issues.map((issue) => issue.kind)).toEqual(["empty_rooms"]);
  });
  it("activates on deliberate edits, retains activity when cleared, and restores untouched presets explicitly", () => {
    const input = newWorksheet(data.options);
    input.rooms[0].windows[0] = editWorksheetWindow(input.rooms[0].windows[0], { width: "300", nightId: "night" });
    const valid = quickQuote(input, data);
    expect(valid).toMatchObject({ roomCount: 1, coveringCount: 1, complete: true });
    expect(valid.quote).toEqual(quickQuote(values(), data).quote);
    expect(valid.items[0].subtotalCents).toBe(windowQuote(valid.windows[0], assumptions).saleSgdCents);
    input.rooms[0].windows[0] = editWorksheetWindow(input.rooms[0].windows[0], { width: "" });
    const pending = quickQuote(input, data);
    expect(pending).toMatchObject({ roomCount: 1, coveringCount: 1, complete: false });
    expect(finalQuoteMetrics(pending.quote.discountedSaleSgdCents, pending.quote.netCostSgdCents, "987", pending.complete).margin).toBeNull();
    input.rooms[0] = clearWorksheetRoom(input.rooms[0], data.options);
    expect(input.rooms).toHaveLength(11);
    expect(quickQuote(input, data).roomCount).toBe(0);
  });
  it("includes extra coverings independently without activating their untouched sibling", () => {
    const input = newWorksheet(data.options);
    input.rooms[0].windows.push({ ...newQuickQuoteWindow("extra", data.options), active: true });
    expect(quickQuote(input, data)).toMatchObject({ roomCount: 1, coveringCount: 1, complete: false });
    input.rooms[0].windows.pop();
    expect(quickQuote(input, data).coveringCount).toBe(0);
  });
  it("preserves legacy windows without activity flags and keeps whole-order adjustments out of item subtotals", () => {
    const input = values(); input.discount = "20"; input.extraInstallation = "100";
    const result = quickQuote(input, data);
    expect(result.coveringCount).toBe(1);
    expect(result.items[0].subtotalCents).toBe(windowQuote(result.windows[0], assumptions).saleSgdCents);
    const undiscounted = quickQuote(values(), data);
    expect(result.items).toEqual(undiscounted.items);
  });
  it("untouched presets do not alter package eligibility or package totals", () => {
    const input = values(); input.packageId = data.packages[0].id;
    input.rooms = [0, 1, 2].map((i) => ({ ...input.rooms[0], id: `active-${i}`, windows: input.rooms[0].windows.map((window) => ({ ...window, id: `active-window-${i}` })) }));
    const expected = quickQuote(input, data);
    input.rooms.push(...newWorksheet(data.options).rooms);
    const actual = quickQuote(input, data);
    expect(actual.quote).toEqual(expected.quote);
    expect(actual).toMatchObject({ roomCount: 3, coveringCount: 3, complete: true });
    expect(actual.items.every((item) => item.includedInPackage)).toBe(true);
  });
});
