import { describe, expect, it } from "vitest";

import {
  parseInstallationDetails,
  resolveInstallationNote,
  resolveInstallationSize,
} from "./installation-details";

describe("resolveInstallationSize", () => {
  const frozen = { widthCm: 205, heightCm: 255 };
  const measured = { widthCm: 210, heightCm: 260 };

  it("returns the frozen size untouched when no override exists (old rendering)", () => {
    expect(resolveInstallationSize(frozen, measured, undefined)).toEqual({
      widthCm: 205,
      heightCm: 255,
      overridden: false,
    });
  });

  it("keeps the old null rendering when there is no frozen row and no override", () => {
    expect(
      resolveInstallationSize(
        { widthCm: null, heightCm: null },
        measured,
        undefined,
      ),
    ).toEqual({ widthCm: null, heightCm: null, overridden: false });
  });

  it("falls back to the measured axis when a width-only override has no frozen row", () => {
    const size = resolveInstallationSize(
      { widthCm: null, heightCm: null },
      measured,
      { width_cm: 190 },
    );
    expect(size.widthCm).toBe(190);
    expect(size.heightCm).toBe(260);
    expect(size.overridden).toBe(true);
  });

  it("falls back to the measured axis when a height-only override has no frozen row", () => {
    const size = resolveInstallationSize(
      { widthCm: null, heightCm: null },
      measured,
      { height_cm: 245 },
    );
    expect(size.widthCm).toBe(210);
    expect(size.heightCm).toBe(245);
    expect(size.overridden).toBe(true);
  });

  it("resolves the untouched axis against the frozen size before the measured one", () => {
    const size = resolveInstallationSize(frozen, measured, { width_cm: 190 });
    expect(size.widthCm).toBe(190);
    expect(size.heightCm).toBe(255);
  });

  it("lets a refrozen value flow through an axis that was never overridden", () => {
    const refrozen = { widthCm: 208, heightCm: 258 };
    const size = resolveInstallationSize(refrozen, measured, { width_cm: 190 });
    expect(size.heightCm).toBe(258);
    expect(size.overridden).toBe(true);
  });

  it("does not flag an override equal to the base value", () => {
    const size = resolveInstallationSize(frozen, measured, { width_cm: 205 });
    expect(size.overridden).toBe(false);
  });
});

describe("resolveInstallationNote", () => {
  it("inherits the original note when no override exists", () => {
    expect(resolveInstallationNote("Ceiling mount", undefined)).toBe(
      "Ceiling mount",
    );
    expect(resolveInstallationNote("Ceiling mount", { note: null })).toBe(
      "Ceiling mount",
    );
  });

  it("treats an empty override as an explicit clear", () => {
    expect(resolveInstallationNote("Ceiling mount", { note: "" })).toBe("");
  });

  it("replaces the original note", () => {
    expect(
      resolveInstallationNote("Ceiling mount", { note: "Drill into beam" }),
    ).toBe("Drill into beam");
  });
});

describe("parseInstallationDetails", () => {
  it("reads a stored document verbatim", () => {
    const details = parseInstallationDetails({
      general_instructions: "Bring a ladder",
      rooms: { "a31fd642-0fe2-4066-9762-880b0e023471": { note: "False ceiling" } },
      openings: {
        "d31fd642-0fe2-4066-9762-880b0e023471": { width_cm: 199, note: "" },
      },
    });
    expect(details.general_instructions).toBe("Bring a ladder");
    expect(details.rooms?.["a31fd642-0fe2-4066-9762-880b0e023471"]).toEqual({
      note: "False ceiling",
    });
    expect(
      details.openings?.["d31fd642-0fe2-4066-9762-880b0e023471"],
    ).toEqual({ width_cm: 199, note: "" });
  });

  it("treats a malformed document as no overrides rather than throwing", () => {
    for (const details of [
      parseInstallationDetails("not json"),
      parseInstallationDetails(null),
    ]) {
      expect(details.general_instructions ?? null).toBeNull();
      expect(details.rooms ?? {}).toEqual({});
      expect(details.openings ?? {}).toEqual({});
    }
  });
});
