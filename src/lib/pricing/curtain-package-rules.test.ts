import { describe, expect, it } from "vitest";
import { CURTAIN_RATE_KEYS, curtainSeriesTier, makePackageContext, packagePricingSignature, readPackageContext, resolveCurtainPackageQuote, type CurtainRates } from "./curtain-package-rules";
import { computeQuote, type CalcAssumptions, type CalcWindow } from "./calculator";

const rates: CurtainRates = {
  ultimate_from_essential_sgd: 25000, ultimate_from_pls_sgd: 10000,
  zen_default_sgd: 10000, zen_4m_sgd: 15000, zen_5m_sgd: 20000,
  s_fold_3m_sgd: 30000, s_fold_4m_sgd: 40000, s_fold_above_4m_sgd: null,
  remove_day_sgd: 5000, remove_essential_sgd: 5000, remove_pls_sgd: 7500,
  add_day_sgd: 10000, add_essential_sgd: 10000, add_pls_sgd: 15000,
  blackout_per_m_sgd: 5000, slim_single_per_m_sgd: 5000, slim_double_per_m_sgd: 7000,
};
const item = { id: "550e8400-e29b-41d4-a716-446655440000", name: "Test 1-room package", packageType: "double" as const,
  roomSetCount: 1, priceSgd: "768.00", tier2UpgradeSgd: "300.00", roomTier2UpgradeSgd: "100.00", roomTier2DowngradeSgd: "75.00" };
const context = () => makePackageContext(item, "essential", "night", rates);
const fabric = (label: string) => ({ label, costRmbCents: 5100, saleSgdCents: 9000 });
const window = (changes: Partial<CalcWindow> = {}): CalcWindow => ({roomIndex: 0, roomLabel: "Living", widthCm: 300, dayPrice: fabric("Signature (day)"), nightPrice: fabric("Essential"), ...changes});
const sfold = { label: "S-Fold", costRmbCents: 1100, saleSgdCents: 8000, basis: "per_metre" as const };
const assumptions: CalcAssumptions = { fxSgdToRmb: 53000, gstBps: 900, otherCostBps: 1000, groupbuyDiscountBps: 1500, styleMultiplier: 20000,
  handymanSingleSgdCents: 6000, handymanDoubleSgdCents: 10000, handymanBlindsSgdCents: 8000, seaFreightRmbCentsPerM3: 40000,
  airFreightRateBps: 6000, airFreightFloorRmbCents: 50000, airFreightCapRmbCents: 140000, trackCostRmbCentsPerM: 2500 };

describe("curtain room rules", () => {
  it.each([[399,10000],[400,15000],[499,15000],[500,20000],[501,20000],[600,20000]])("Zen %scm adds %s cents", (widthCm, amount) => {
    const result = resolveCurtainPackageQuote([window({widthCm, dayPrice: fabric("Zen (day)")})], context());
    expect(result.issues).toEqual([]); expect(result.totalSgdCents).toBe(76800 + amount);
  });
  it.each([[200,30000],[300,30000],[320,30000],[399,30000],[400,40000]])("S-fold %scm adds %s cents", (widthCm, amount) => {
    expect(resolveCurtainPackageQuote([window({widthCm, addons:[sfold]})], context()).totalSgdCents).toBe(76800 + amount);
  });
  it("blocks above-4m S-fold until configured, including 4.01m", () => {
    const windows = [window({widthCm:401, addons:[sfold]})];
    expect(resolveCurtainPackageQuote(windows, context()).issues).toEqual(["Living · S-fold (4.01m): price not configured"]);
    const configured = context(); configured.rates.s_fold_above_4m_sgd = 50000;
    expect(resolveCurtainPackageQuote(windows, configured).totalSgdCents).toBe(126800);
  });
  it("charges Zen once for a multi-window room using summed measured width", () => {
    const windows = [window({widthCm:220, dayPrice:fabric("Zen")}), window({widthCm:230, dayPrice:fabric("Zen")})];
    const result = resolveCurtainPackageQuote(windows, context());
    expect(result.issues).toEqual([]); expect(result.totalSgdCents).toBe(91800); expect(result.lines).toHaveLength(2);
  });
  it("charges room Ultimate from the selected package tier, never twice", () => {
    const windows = [window({nightPrice:fabric("Ultimate")})];
    expect(resolveCurtainPackageQuote(windows, context()).totalSgdCents).toBe(101800);
    expect(resolveCurtainPackageQuote(windows, {...context(), tier:"tier2"}).totalSgdCents).toBe(116800);
  });
  it("uses independent upgrade and downgrade rates", () => {
    expect(resolveCurtainPackageQuote([window({nightPrice:fabric("Performance")})], context()).totalSgdCents).toBe(86800);
    expect(resolveCurtainPackageQuote([window()], {...context(), tier:"tier2"}).totalSgdCents).toBe(99300);
  });
  it("does not infer missing room rates from a whole-package top-up", () => {
    const noRates = {...context(), roomUpgradeCents:null, roomDowngradeCents:null};
    expect(resolveCurtainPackageQuote([window({nightPrice:fabric("Signature")})], noRates).issues).toHaveLength(1);
    expect(resolveCurtainPackageQuote([window()], {...noRates, tier:"tier2"}).issues).toHaveLength(1);
    expect(resolveCurtainPackageQuote([window()], {...noRates, tier:"tier2", roomDowngradeCents:0}).issues).toEqual([]);
  });
  it("distinguishes layer removal from fabric downgrade", () => {
    expect(resolveCurtainPackageQuote([window({nightPrice:null})], {...context(), tier:"tier2"}).totalSgdCents).toBe(99300);
    expect(resolveCurtainPackageQuote([window({dayPrice:null})], context()).totalSgdCents).toBe(71800);
  });
  it("supports single Day, single Night and adding layers without treating an empty selection as a credit", () => {
    const single = {...context(), packageType:"single" as const};
    expect(resolveCurtainPackageQuote([window({dayPrice:null})], single).totalSgdCents).toBe(76800);
    expect(resolveCurtainPackageQuote([window({nightPrice:null})], {...single,singleLayer:"day"}).totalSgdCents).toBe(76800);
    expect(resolveCurtainPackageQuote([window()], single).totalSgdCents).toBe(86800);
    expect(resolveCurtainPackageQuote([window({nightPrice:fabric("Ultimate")})], {...single,singleLayer:"day"}).totalSgdCents).toBe(111800);
    expect(resolveCurtainPackageQuote([window({dayPrice:null,nightPrice:null})], context()).issues).toHaveLength(1);
  });
  it("rejects room-count mismatch, missing width, unknown series and mixed tiers within a room", () => {
    for (const windows of [[],[window({widthCm:null})],[window({nightPrice:fabric("Unknown")})],[window(),window({nightPrice:fabric("Ultimate")})]]) {
      expect(resolveCurtainPackageQuote(windows,context()).issues.length).toBeGreaterThan(0);
    }
  });
  it("preserves series recognition without substring guesses", () => {
    expect(curtainSeriesTier("Signature (day)")).toBe("tier2");
    expect(curtainSeriesTier("Luxe")).toBe("tier2");
    expect(curtainSeriesTier("Lux")).toBe("tier2");
    expect(curtainSeriesTier("Not Essential")).toBe("unknown");
    expect(curtainSeriesTier("Ultimate Plus")).toBe("ultimate");
  });
  it("serialises immutable rate snapshots and refuses malformed snapshots", () => {
    const original = context(); const snapshot = readPackageContext(JSON.parse(JSON.stringify(original)))!;
    original.rates.zen_default_sgd = 99999;
    expect(snapshot.rates.zen_default_sgd).toBe(10000);
    expect(() => readPackageContext({version:1})).toThrow();
    expect(Object.keys(snapshot.rates).length).toBe(CURTAIN_RATE_KEYS.length);
  });
  it("detects pricing changes independently of JSONB property order", () => {
    const original = context(); const signature = packagePricingSignature(original);
    const reordered = { ...original, rates: Object.fromEntries(Object.entries(original.rates).reverse()) as CurtainRates };
    expect(packagePricingSignature(reordered)).toBe(signature);
    reordered.rates.zen_default_sgd = 20000;
    expect(packagePricingSignature(reordered)).not.toBe(signature);
  });
  it("charges blackout by width and slim tracks by the resulting layer count", () => {
    const extras = [{...sfold,key:"blackout"},{...sfold,key:"slim_tracks"}];
    expect(resolveCurtainPackageQuote([window({addons:extras})],context()).totalSgdCents).toBe(76800+15000+21000);
    expect(resolveCurtainPackageQuote([window({dayPrice:null,addons:extras})],context()).totalSgdCents).toBe(76800-5000+15000+15000);
  });
  it("combines whole-package price, different room upgrades, credits and Zen exactly once", () => {
    const windows = [window({roomIndex:0,nightPrice:fabric("Ultimate")}),window({roomIndex:1,dayPrice:fabric("Zen"),widthCm:450}),window({roomIndex:2,nightPrice:fabric("Signature")})];
    const result = resolveCurtainPackageQuote(windows,{...context(),roomSetCount:3,tier:"tier2"});
    expect(result.issues).toEqual([]);
    expect(result.totalSgdCents).toBe(76800+30000+10000-7500+15000);
  });
  it("prevents credits exceeding package price", () => {
    expect(resolveCurtainPackageQuote([window()], {...context(),tier:"tier2",roomDowngradeCents:200000}).issues).toContain("Package credits cannot exceed the package and upgrade charges");
  });
});

describe("integrated quote", () => {
  it("keeps package extras identified after a display-name change", () => {
    const result = computeQuote([window({addons:[{...sfold,key:"s_fold",label:"Wave heading"}]})],assumptions,"air",0,0,context());
    expect(result.saleSgdCents).toBe(106800);
    expect(result.pricingIssues).toEqual([]);
  });
  it("replaces matching add-on sale but preserves COGS, tracks, freight, install and other items", () => {
    const windows = [window({addons:[sfold,{label:"Special delivery",costRmbCents:500,saleSgdCents:2000,basis:"per_unit"}]}),
      {roomIndex:1,widthCm:200,blindPrice:fabric("Roller"),addons:[sfold]}];
    const normal = computeQuote(windows,assumptions);
    const packaged = computeQuote(windows,assumptions,"air",0,1000,context());
    expect(packaged.pricingIssues).toEqual([]);
    // Package 768 + S-fold 300 + delivery 20 + blind 180 + blind S-fold 160.
    expect(packaged.saleSgdCents).toBe(142800);
    expect(packaged.discountedSaleSgdCents).toBe(128520);
    expect(packaged.groupbuySgdCents).toBe(packaged.discountedSaleSgdCents);
    for (const key of ["cogsRmbCents","freightRmbCents","installationSgdCents","netCostSgdCents"] as const) expect(packaged[key]).toBe(normal[key]);
  });
  it("suppresses partial prices when an adjustment is unconfigured", () => {
    const result = computeQuote([window({widthCm:410,addons:[sfold]})], assumptions, "air",0,0,context());
    expect(result.saleSgdCents).toBe(0); expect(result.discountedSaleSgdCents).toBe(0);
    expect(result.pricingIssues).toHaveLength(1); expect(result.cogsRmbCents).toBeGreaterThan(0);
  });
  it("measured pricing ignores manufacturing allowance width", () => {
    const a = computeQuote([window({widthCm:500,dayPrice:fabric("Zen")})],assumptions,"air",0,0,context());
    const b = computeQuote([window({widthCm:500,costWidthCm:490,dayPrice:fabric("Zen")})],assumptions,"air",0,0,context());
    expect(a.saleSgdCents).toBe(b.saleSgdCents); expect(a.cogsRmbCents).not.toBe(b.cogsRmbCents);
  });
});
