import { describe, expect, it } from "vitest";

import {
  deltaTone,
  draftFor,
  evaluateRow,
  parseDelta,
  syncDraft,
  type ReconLine,
} from "./reconciliation-row";

// 300 × 260 measured, curtain allowance −2 / −4.
function line(over: Partial<ReconLine> = {}): ReconLine {
  return {
    lineId: "line-1",
    kind: "window",
    label: "Window 1",
    description: "Essential #4 — 常青藤-4",
    sourceWidthCm: 300,
    sourceHeightCm: 260,
    mfgWidthCm: 298,
    mfgHeightCm: 256,
    ...over,
  };
}

describe("draftFor", () => {
  it("seeds both views of the number from the computed candidate", () => {
    expect(draftFor(line())).toEqual({
      width: "298",
      height: "256",
      widthDelta: "-2",
      heightDelta: "-4",
      splitLeft: "",
      splitRight: "",
      reason: "",
    });
  });
});

describe("double-draw split", () => {
  const splitLine = line({
      splitLeftCm: 138,
      splitRightCm: 119,
      mfgWidthCm: 255,
    });

  it("seeds editable PO sides scaled to the manufacturing width", () => {
    expect(draftFor(splitLine)).toMatchObject({
      splitLeft: "137",
      splitRight: "118",
    });
  });

  it("accepts an edited split when it adds up to the manufacturing width", () => {
    const state = evaluateRow(splitLine, {
      ...draftFor(splitLine),
      splitLeft: "140",
      splitRight: "115",
    });
    expect(state.errors).toEqual([]);
    expect(state.splitOverridden).toBe(true);
    expect(state.overridden).toBe(true);
  });

  it("blocks confirmation when the edited split does not match the total", () => {
    const state = evaluateRow(splitLine, {
      ...draftFor(splitLine),
      splitLeft: "140",
    });
    expect(state.errors).toContain(
      "The PO split must add up to the 255 cm manufacturing width.",
    );
  });
});

describe("parseDelta", () => {
  it("accepts a negative, a zero and a positive", () => {
    expect(parseDelta("-4")).toBe(-4);
    expect(parseDelta("0")).toBe(0);
    expect(parseDelta("3")).toBe(3);
  });

  // Typing "-12" passes through "-", which must not be read as a number or the
  // paired field would be rewritten from a value the person never finished.
  it("rejects a lone minus and other part-typed input", () => {
    expect(parseDelta("-")).toBeNull();
    expect(parseDelta("")).toBeNull();
    expect(parseDelta("-2.5")).toBeNull();
    expect(parseDelta("2 8")).toBeNull();
  });
});

describe("syncDraft — editing the allowance drives the manufacturing size", () => {
  const l = line();

  it("recomputes the width from a new delta", () => {
    const out = syncDraft(l, draftFor(l), { widthDelta: "-5" });
    expect(out.widthDelta).toBe("-5");
    expect(out.width).toBe("295");
  });

  it("recomputes the height from a new delta", () => {
    const out = syncDraft(l, draftFor(l), { heightDelta: "-10" });
    expect(out.heightDelta).toBe("-10");
    expect(out.height).toBe("250");
  });

  it("handles a positive delta — the sign is meaningful", () => {
    const out = syncDraft(l, draftFor(l), { widthDelta: "6" });
    expect(out.width).toBe("306");
  });

  it("handles a zero delta as manufacture-at-measured", () => {
    const out = syncDraft(l, draftFor(l), { widthDelta: "0" });
    expect(out.width).toBe("300");
  });

  it("leaves the width alone while the delta is still being typed", () => {
    const out = syncDraft(l, draftFor(l), { widthDelta: "-" });
    expect(out.widthDelta).toBe("-");
    expect(out.width).toBe("298");
  });

  it("touches only the axis that changed", () => {
    const out = syncDraft(l, draftFor(l), { widthDelta: "-5" });
    expect(out.height).toBe("256");
    expect(out.heightDelta).toBe("-4");
  });
});

describe("syncDraft — editing the manufacturing size drives the allowance", () => {
  const l = line();

  it("recomputes the delta from a new width", () => {
    const out = syncDraft(l, draftFor(l), { width: "290" });
    expect(out.width).toBe("290");
    expect(out.widthDelta).toBe("-10");
  });

  it("recomputes the delta from a new height", () => {
    const out = syncDraft(l, draftFor(l), { height: "250" });
    expect(out.heightDelta).toBe("-10");
  });

  it("leaves the delta alone while the size is still being typed", () => {
    const out = syncDraft(l, draftFor(l), { width: "" });
    expect(out.width).toBe("");
    expect(out.widthDelta).toBe("-2");
  });

  it("round-trips: a delta edit then a size edit back agrees", () => {
    const a = syncDraft(l, draftFor(l), { widthDelta: "-5" });
    const b = syncDraft(l, a, { width: "298" });
    expect(b.widthDelta).toBe("-2");
  });
});

describe("syncDraft — the reason rides along untouched", () => {
  it("keeps a typed reason when a dimension changes", () => {
    const l = line();
    const withReason = syncDraft(l, draftFor(l), { reason: "site re-measure" });
    const out = syncDraft(l, withReason, { widthDelta: "-5" });
    expect(out.reason).toBe("site re-measure");
  });
});

describe("evaluateRow", () => {
  it("flags a row whose size differs from the configured allowance", () => {
    const l = line();
    const s = evaluateRow(l, syncDraft(l, draftFor(l), { widthDelta: "-5" }));
    expect(s.widthOverridden).toBe(true);
    expect(s.overridden).toBe(true);
    // The delta shown is measured against the SOURCE, so the row reconciles.
    expect(s.widthDeltaCm).toBe(-5);
    expect(s.widthCm).toBe(295);
  });

  it("does not flag a row left at the configured allowance", () => {
    const l = line();
    expect(evaluateRow(l, draftFor(l)).overridden).toBe(false);
  });

  // Retyping the same number is not a change, and must not mark the row.
  it("does not flag retyping the computed value", () => {
    const l = line();
    const s = evaluateRow(l, syncDraft(l, draftFor(l), { width: "298" }));
    expect(s.widthOverridden).toBe(false);
  });

  it("errors on a size that is not a whole positive number", () => {
    const l = line();
    for (const width of ["0", "-3", "29.5", "", "abc"]) {
      expect(evaluateRow(l, { ...draftFor(l), width }).errors.length).toBe(1);
    }
  });

  // A reason is no longer required, so an adjusted row with none is valid.
  it("does not error on an adjusted row with no reason", () => {
    const l = line();
    const s = evaluateRow(l, syncDraft(l, draftFor(l), { widthDelta: "-5" }));
    expect(s.errors).toEqual([]);
  });
});

describe("deltaTone — the allowance box is coloured by sign", () => {
  it("is red when material comes off the opening", () => {
    expect(deltaTone("-2")).toMatch(/rose/);
    expect(deltaTone("-40")).toMatch(/rose/);
  });

  it("is green when material is added", () => {
    expect(deltaTone("3")).toMatch(/emerald/);
  });

  // A zero allowance changes nothing, so it should not shout either way.
  it("is quiet at zero", () => {
    const t = deltaTone("0");
    expect(t).not.toMatch(/rose|emerald/);
  });

  it("stays neutral while a value is still being typed", () => {
    expect(deltaTone("-")).not.toMatch(/rose|emerald/);
    expect(deltaTone("")).not.toMatch(/rose|emerald/);
  });
});
