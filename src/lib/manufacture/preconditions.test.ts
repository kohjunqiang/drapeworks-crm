import { describe, expect, it } from "vitest";

import type { AllowanceBook } from "./allowance";
import type { ManufactureLine } from "./load";
import {
  checkConfirmPreconditions,
  type LineOverride,
  type OverrideMap,
} from "./preconditions";

const BOOK: AllowanceBook = {
  curtain: { widthDeltaCm: -2, heightDeltaCm: -4 },
  blind: { widthDeltaCm: -1, heightDeltaCm: -1 },
  mesh: { widthDeltaCm: 0, heightDeltaCm: 0 },
};

function line(over: Partial<ManufactureLine> = {}): ManufactureLine {
  return {
    lineId: "line-1",
    kind: "window",
    roomLabel: "Living Room",
    roomPosition: 1,
    position: 1,
    line: "curtain",
    description: "Series A #3 — 3021-15",
    widthCm: 200,
    heightCm: 260,
    ...over,
  };
}

function overrides(entries: [string, LineOverride][] = []): OverrideMap {
  return new Map(entries);
}

describe("checkConfirmPreconditions", () => {
  it("accepts a well-formed order", () => {
    expect(
      checkConfirmPreconditions([line()], BOOK, "deposit_received", overrides()),
    ).toEqual({ ok: true });
  });

  it("accepts an editable PO split that matches the manufacturing width", () => {
    expect(checkConfirmPreconditions(
      [line({ widthCm: 257, splitLeftCm: 138, splitRightCm: 119 })],
      BOOK,
      "deposit_received",
      overrides([["line-1", { mfgSplitLeftCm: 140, mfgSplitRightCm: 115 }]]),
    )).toEqual({ ok: true });
  });

  it("refuses a PO split that does not match the manufacturing width", () => {
    const result = checkConfirmPreconditions(
      [line({ widthCm: 257, splitLeftCm: 138, splitRightCm: 119 })],
      BOOK,
      "deposit_received",
      overrides([["line-1", { mfgSplitLeftCm: 140, mfgSplitRightCm: 118 }]]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons.join(" ")).toContain("must add up to its 255 cm");
  });

  it("refuses a status other than deposit_received, naming the current one", () => {
    const result = checkConfirmPreconditions(
      [line()],
      BOOK,
      "order_recorded",
      overrides(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons.join(" ")).toContain("Order Recorded");
  });

  // Null is UNCONFIGURED, not zero. Confirming against it would silently
  // manufacture at the measured size.
  it("refuses a line whose allowance is unconfigured, naming which line", () => {
    const result = checkConfirmPreconditions(
      [line({ line: "blind" })],
      { ...BOOK, blind: null },
      "deposit_received",
      overrides(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons.join(" ")).toMatch(/blind allowance/i);
  });

  it("refuses a line with no measured width, naming the room and position", () => {
    const result = checkConfirmPreconditions(
      [line({ widthCm: null, roomLabel: "Master Bedroom", position: 2 })],
      BOOK,
      "deposit_received",
      overrides(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const joined = result.reasons.join(" ");
    expect(joined).toContain("Master Bedroom");
    // position 2 in the database is "Window 3" on screen. The message has to
    // match what the reader is looking at, not the storage index.
    expect(joined).toContain("Window 3");
  });

  it("refuses a line whose measured height is zero", () => {
    const result = checkConfirmPreconditions(
      [line({ heightCm: 0 })],
      BOOK,
      "deposit_received",
      overrides(),
    );
    expect(result.ok).toBe(false);
  });

  it("refuses a computed dimension of zero or less when nothing is overridden", () => {
    const result = checkConfirmPreconditions(
      [line({ widthCm: 2 })],
      BOOK,
      "deposit_received",
      overrides(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons).toHaveLength(1);
  });

  // The whole point of an override: a human has looked at the impossible
  // number and said what to build instead.
  it("accepts an impossible computed dimension when an override with a reason fixes it", () => {
    const result = checkConfirmPreconditions(
      [line({ widthCm: 2 })],
      BOOK,
      "deposit_received",
      overrides([
        [
          "line-1",
          { overrideWidthCm: 180, overrideReason: "Vendor confirmed 180cm" },
        ],
      ]),
    );
    expect(result).toEqual({ ok: true });
  });

  it("still refuses when the override leaves the other dimension impossible", () => {
    const result = checkConfirmPreconditions(
      [line({ widthCm: 2, heightCm: 3 })],
      BOOK,
      "deposit_received",
      overrides([
        [
          "line-1",
          { overrideWidthCm: 180, overrideReason: "Vendor confirmed 180cm" },
        ],
      ]),
    );
    expect(result.ok).toBe(false);
  });

  // A reason is optional now that the allowance is editable per line, so an
  // adjustment without one is a normal, buildable order — not an error.
  it("accepts an override with no reason", () => {
    const result = checkConfirmPreconditions(
      [line()],
      BOOK,
      "deposit_received",
      overrides([["line-1", { overrideWidthCm: 180 }]]),
    );
    expect(result.ok).toBe(true);
  });

  // Fixing one problem at a time, with a round trip to the server between
  // each, is a miserable way to correct an order.
  it("reports every failing reason, not just the first", () => {
    const result = checkConfirmPreconditions(
      [
        line({ lineId: "line-1", widthCm: null }),
        line({ lineId: "line-2", line: "blind", position: 2 }),
      ],
      { ...BOOK, blind: null },
      "deposit_received",
      overrides(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons).toHaveLength(2);
  });

  it("names a mesh panel as a panel, not a window", () => {
    const result = checkConfirmPreconditions(
      [
        line({
          kind: "mesh_panel",
          line: "mesh",
          widthCm: null,
          roomLabel: "Balcony",
          position: 3,
        }),
      ],
      BOOK,
      "deposit_received",
      overrides(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons.join(" ")).toMatch(/Balcony Panel 4/);
  });
});
