import { randomInt } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  REFERENCE_ALPHABET,
  REFERENCE_LENGTH,
  generateOrderReference,
  isGeneratedReference,
  primaryOrderIdentifier,
} from "./reference";

// A deterministic source, so the shape is tested rather than the randomness.
function cycling(values: number[]): (max: number) => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe("generateOrderReference", () => {
  it("is eight characters", () => {
    expect(generateOrderReference(cycling([0]))).toHaveLength(REFERENCE_LENGTH);
  });

  it("draws every character from the alphabet", () => {
    const ref = generateOrderReference((max) => randomInt(max));
    for (const c of ref) expect(REFERENCE_ALPHABET).toContain(c);
  });

  it("maps the random index straight onto the alphabet", () => {
    expect(generateOrderReference(cycling([0, 1, 2, 3, 4, 5, 6, 7]))).toBe(
      "ABCDEFGH",
    );
  });

  // This code is read down a phone line and typed back by a factory. O/0 and
  // I/1 are the pairs that get confused doing exactly that.
  it("omits the glyphs that are misread aloud", () => {
    for (const c of ["O", "0", "I", "1"]) {
      expect(REFERENCE_ALPHABET).not.toContain(c);
    }
  });

  it("is uppercase, since a reference read aloud has no case", () => {
    const ref = generateOrderReference((max) => randomInt(max));
    expect(ref).toBe(ref.toUpperCase());
  });

  it("does not repeat itself across many draws", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      seen.add(generateOrderReference((max) => randomInt(max)));
    }
    // 32^8 possibilities: 500 draws colliding would mean the source is broken.
    expect(seen.size).toBe(500);
  });
});

describe("primaryOrderIdentifier", () => {
  it("uses the PO reference before the legacy DW identifier", () => {
    expect(primaryOrderIdentifier("10044", "DW-2026-0006")).toBe("10044");
  });

  it("falls back to the DW identifier when no PO reference exists", () => {
    expect(primaryOrderIdentifier(null, "DW-2026-0006")).toBe("DW-2026-0006");
    expect(primaryOrderIdentifier("  ", "DW-2026-0006")).toBe("DW-2026-0006");
  });
});

describe("isGeneratedReference", () => {
  it("recognises one of ours", () => {
    expect(isGeneratedReference("ABCDEFGH")).toBe(true);
  });

  it("rejects the wrong length", () => {
    expect(isGeneratedReference("ABCDEFG")).toBe(false);
    expect(isGeneratedReference("ABCDEFGHI")).toBe(false);
  });

  it("rejects a hand-written reference", () => {
    // The business still types its own, and those must not be mistaken for ours.
    expect(isGeneratedReference("SJ-2026-118")).toBe(false);
    expect(isGeneratedReference("10040")).toBe(false);
    expect(isGeneratedReference("ABCDEFG0")).toBe(false);
  });
});
