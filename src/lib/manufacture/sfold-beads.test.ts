import { describe, expect, it } from "vitest";
import { defaultBeads, MAX_BEAD_COUNT, parseBeadCount } from "./sfold-beads";
import { manufactureLineSchema } from "@/lib/validation/manufacture";
describe("S-fold bead defaults and storage bounds", () => {
  it("rounds each original measured leaf upward to an even count", () => {
    expect(defaultBeads({ draw: "Single Left", widthCm: 150 })).toEqual({ kind: "single", count: 26 });
    expect(defaultBeads({ draw: "Double", widthCm: 300 })).toEqual({ kind: "pair", left: 26, right: 26 });
    expect(defaultBeads({ draw: "Double", widthCm: 336, splitLeftCm: 120, splitRightCm: 216 })).toEqual({ kind: "pair", left: 20, right: 36 });
  });
  it.each(["", "-2", "0", "25", "2.5", "2147483648"])("rejects %s in both UI and request validation", (value) => {
    expect(parseBeadCount(value)).toBeNull();
    if (value) expect(manufactureLineSchema.safeParse({ lineId: "11111111-1111-4111-8111-111111111111", kind: "window", sFoldBeadCount: Number(value) }).success).toBe(false);
  });
  it("accepts the largest even database integer", () => {
    expect(parseBeadCount(String(MAX_BEAD_COUNT))).toBe(MAX_BEAD_COUNT);
    expect(manufactureLineSchema.safeParse({ lineId: "11111111-1111-4111-8111-111111111111", kind: "window", sFoldBeadCount: MAX_BEAD_COUNT }).success).toBe(true);
  });
});
