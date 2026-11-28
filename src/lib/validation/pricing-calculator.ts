import { z } from "zod";

// Strings preserve unfinished edits (including an empty manual quote). Nothing is
// saved: validity is checked before presenting a complete monetary result.
export const calculatorWindowSchema = z.object({
  active: z.boolean().optional(),
  id: z.string(), covering: z.enum(["day", "night", "both", "blind"]),
  width: z.string(), height: z.string(), dayId: z.string(), nightId: z.string(), blindId: z.string(),
  addonIds: z.array(z.string()), dayTrack: z.boolean(), nightTrack: z.boolean(),
  noInstallation: z.boolean(), comboId: z.string(),
});
export const pricingCalculatorSchema = z.object({
  rooms: z.array(z.object({ id: z.string(), label: z.string(), preset: z.boolean().optional(), windows: z.array(calculatorWindowSchema) })),
  packageId: z.string(), packageTier: z.enum(["essential", "tier2"]), singleLayer: z.enum(["day", "night"]),
  discount: z.string(), freight: z.enum(["air", "sea"]), channel: z.enum(["standard", "carousell"]), extraInstallation: z.string(),
});
export type CalculatorValues = z.infer<typeof pricingCalculatorSchema>;
export type CalculatorWindow = z.infer<typeof calculatorWindowSchema>;
export type CalculatorRoom = CalculatorValues["rooms"][number];
export const calculatorDefaults: CalculatorValues = {
  rooms: [], packageId: "", packageTier: "essential", singleLayer: "night",
  discount: "0", freight: "air", channel: "standard", extraInstallation: "0",
};
export function newCalculatorWindow(id: string, covering: CalculatorWindow["covering"] = "both"): CalculatorWindow {
  return { id, covering, width: "", height: "", dayId: "", nightId: "", blindId: "", addonIds: [], dayTrack: true, nightTrack: true, noInstallation: false, comboId: "" };
}
