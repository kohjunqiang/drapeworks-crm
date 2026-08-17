import { describe, expect, it } from "vitest";

import {
  formatMmAsCm,
  isDoubleDraw,
  meshSystemProblems,
  meshTrackSegments,
  resolveMeshSystem,
  resolveMeshTrack,
  type MeshSystemBand,
  type MeshSystemSpec,
} from "./mesh-system";

// The shipped specs, in millimetres. 55: 6.5 + 4.3, 68: 7.8 + 5.5,
// 80: 9.0 + 5.5, side track 1.5 throughout.
const SPECS: MeshSystemSpec[] = [
  { name: "System 55", rollerMm: 65, handleMm: 43, sideTrackMm: 15, insetDeductionMm: 5 },
  { name: "System 68", rollerMm: 78, handleMm: 55, sideTrackMm: 15, insetDeductionMm: 5 },
  { name: "System 80", rollerMm: 90, handleMm: 55, sideTrackMm: 15, insetDeductionMm: 5 },
];

// The shipped matrix, in the order an admin would NOT enter it — resolution
// must sort by width itself rather than trusting input or display order.
const BANDS: MeshSystemBand[] = [
  { maxWidthCm: 380, singleSystem: "System 80", doubleSystem: "System 68" },
  { maxWidthCm: 150, singleSystem: "System 55", doubleSystem: "System 55" },
  { maxWidthCm: 760, singleSystem: null, doubleSystem: "System 80" },
  { maxWidthCm: 250, singleSystem: "System 68", doubleSystem: "System 55" },
  { maxWidthCm: 500, singleSystem: null, doubleSystem: "System 68" },
  { maxWidthCm: 300, singleSystem: "System 80", doubleSystem: "System 55" },
];

const single = (widthCm: number | null) =>
  resolveMeshSystem({ widthCm, draw: "Single Left" }, BANDS);
const double = (widthCm: number | null) =>
  resolveMeshSystem({ widthCm, draw: "Double" }, BANDS);

describe("isDoubleDraw", () => {
  it("treats every single direction as one leaf", () => {
    expect(isDoubleDraw("Double")).toBe(true);
    for (const d of [
      "Single Left",
      "Single Right",
      "Single Top",
      "Single Bottom",
    ] as const) {
      expect(isDoubleDraw(d)).toBe(false);
    }
  });
});

describe("resolveMeshSystem — the shipped matrix", () => {
  it("matches every single-draw row", () => {
    expect(single(150)).toEqual({ status: "resolved", system: "System 55" });
    expect(single(250)).toEqual({ status: "resolved", system: "System 68" });
    expect(single(300)).toEqual({ status: "resolved", system: "System 80" });
    expect(single(380)).toEqual({ status: "resolved", system: "System 80" });
  });

  it("matches every double-draw row", () => {
    expect(double(150)).toEqual({ status: "resolved", system: "System 55" });
    expect(double(250)).toEqual({ status: "resolved", system: "System 55" });
    expect(double(300)).toEqual({ status: "resolved", system: "System 55" });
    expect(double(380)).toEqual({ status: "resolved", system: "System 68" });
    expect(double(500)).toEqual({ status: "resolved", system: "System 68" });
    expect(double(760)).toEqual({ status: "resolved", system: "System 80" });
  });

  it("treats a band's upper bound as inclusive", () => {
    // 1.5 m is still the first band; 1.51 m steps up.
    expect(single(150)).toEqual({ status: "resolved", system: "System 55" });
    expect(single(151)).toEqual({ status: "resolved", system: "System 68" });
  });

  it("gives a double draw a lighter system than a single at the same width", () => {
    expect(single(300)).toEqual({ status: "resolved", system: "System 80" });
    expect(double(300)).toEqual({ status: "resolved", system: "System 55" });
  });

  it("resolves the same whatever order the bands arrive in", () => {
    const reversed = [...BANDS].reverse();
    expect(resolveMeshSystem({ widthCm: 220, draw: "Single Right" }, reversed))
      .toEqual({ status: "resolved", system: "System 68" });
  });
});

describe("resolveMeshSystem — not possible", () => {
  it("rejects a single draw past the widest single band", () => {
    expect(single(381)).toEqual({
      status: "not-possible",
      widthCm: 381,
      isDouble: false,
    });
    expect(single(760)).toEqual({
      status: "not-possible",
      widthCm: 760,
      isDouble: false,
    });
  });

  it("rejects any draw wider than the last band", () => {
    // No open-ended band: past the matrix is an error, never the heaviest
    // profile by default.
    expect(double(761).status).toBe("not-possible");
    expect(single(761).status).toBe("not-possible");
  });
});

describe("resolveMeshSystem — incomplete", () => {
  it("is not an error before a width is entered", () => {
    expect(single(null)).toEqual({ status: "incomplete" });
    expect(single(0)).toEqual({ status: "incomplete" });
  });

  it("is not an error before a draw is chosen", () => {
    expect(resolveMeshSystem({ widthCm: 200, draw: undefined }, BANDS)).toEqual({
      status: "incomplete",
    });
  });

  it("is incomplete, not not-possible, for a wholly blank panel", () => {
    expect(
      resolveMeshSystem({ widthCm: null, draw: undefined }, BANDS),
    ).toEqual({ status: "incomplete" });
  });
});

describe("resolveMeshTrack", () => {
  const track = (widthCm: number, draw: "Single Left" | "Double") =>
    resolveMeshTrack({ widthCm, draw }, BANDS, SPECS);

  it("subtracts one stack and the side track on a single draw", () => {
    // The worked example: 200 cm, System 68 → 200 − 13.3 − 1.5 = 185.2.
    expect(track(200, "Single Left")).toEqual({
      status: "resolved",
      trackMm: 1852,
      system: "System 68",
      rollerMm: 78,
      handleMm: 55,
      sideTrackMm: 15,
      leaves: 1,
      insetMm: 0,
    });
  });

  it("subtracts two stacks and no side track on a double draw", () => {
    // 200 cm double is System 55 → 200 − 10.8 − 10.8 = 178.4.
    expect(track(200, "Double")).toEqual({
      status: "resolved",
      trackMm: 1784,
      system: "System 55",
      rollerMm: 65,
      handleMm: 43,
      // A double carries no side track, so it is reported as zero rather than
      // as the system's figure the UI would then have to know to ignore.
      sideTrackMm: 0,
      leaves: 2,
      insetMm: 0,
    });
  });

  it("matches the rest of the single-draw worked examples", () => {
    // 150 → System 55: 150 − 10.8 − 1.5 = 137.7
    expect(track(150, "Single Left")).toMatchObject({ trackMm: 1377 });
    // 350 → System 80: 350 − 14.5 − 1.5 = 334.0
    expect(track(350, "Single Left")).toMatchObject({ trackMm: 3340 });
  });

  it("stays exact integer arithmetic — no float residue", () => {
    // 185.2 cm is not representable exactly as a float; 1852 mm is.
    const r = track(200, "Single Left");
    expect(r).toMatchObject({ trackMm: 1852 });
    if (r.status === "resolved") expect(Number.isInteger(r.trackMm)).toBe(true);
  });

  it("is incomplete when no system resolves", () => {
    expect(track(400, "Single Left")).toEqual({ status: "incomplete" });
    expect(
      resolveMeshTrack({ widthCm: null, draw: "Double" }, BANDS, SPECS),
    ).toEqual({ status: "incomplete" });
  });

  it("reports a system with no dimensions rather than guessing", () => {
    expect(
      resolveMeshTrack({ widthCm: 200, draw: "Single Left" }, BANDS, []),
    ).toEqual({ status: "unknown-system", system: "System 68" });
  });

  it("matches the system name case-insensitively", () => {
    const shouty: MeshSystemSpec[] = [
      {
        name: "  SYSTEM 68 ",
        rollerMm: 78,
        handleMm: 55,
        sideTrackMm: 15,
        insetDeductionMm: 5,
      },
    ];
    expect(
      resolveMeshTrack({ widthCm: 200, draw: "Single Left" }, BANDS, shouty),
    ).toMatchObject({ trackMm: 1852 });
  });

  it("takes the clearance off the track for a horizontal inset", () => {
    const plain = resolveMeshTrack(
      { widthCm: 200, draw: "Single Left" },
      BANDS,
      SPECS,
    );
    const inset = resolveMeshTrack(
      { widthCm: 200, draw: "Single Left", hasInsetHorizontal: true },
      BANDS,
      SPECS,
    );

    expect(plain).toMatchObject({ trackMm: 1852, insetMm: 0 });
    // 0.5 cm shorter so the panel can be tilted into place.
    expect(inset).toMatchObject({ trackMm: 1847, insetMm: 5 });
  });

  it("applies the clearance on a double draw too", () => {
    expect(
      resolveMeshTrack(
        { widthCm: 200, draw: "Double", hasInsetHorizontal: true },
        BANDS,
        SPECS,
      ),
    ).toMatchObject({ trackMm: 1779, insetMm: 5 });
  });

  it("refuses a window narrower than its own hardware", () => {
    // 14 cm single draw on System 55: 108 + 15 = 123 mm of hardware.
    expect(track(12, "Single Left")).toEqual({
      status: "too-narrow",
      system: "System 55",
      minimumMm: 123,
    });
  });
});

describe("meshTrackSegments", () => {
  const segments = (widthCm: number, draw: "Single Left" | "Double") => {
    const r = resolveMeshTrack({ widthCm, draw }, BANDS, SPECS);
    if (r.status !== "resolved") throw new Error(`unresolved: ${r.status}`);
    return meshTrackSegments(r)
      .map((seg) => `${formatMmAsCm(seg.mm)} (${seg.label})`)
      .join(" + ");
  };

  it("mirrors the hardware on a double draw", () => {
    expect(segments(240, "Double")).toBe(
      "6.5 (roller) + 4.3 (handle) + 218.4 (track) + 4.3 (handle) + 6.5 (roller)",
    );
  });

  it("puts the side track on the far edge of a single draw", () => {
    expect(segments(200, "Single Left")).toBe(
      "7.8 (roller) + 5.5 (handle) + 185.2 (track) + 1.5 (side track)",
    );
  });

  it("appends the clearance when the opening is inset horizontally", () => {
    const r = resolveMeshTrack(
      { widthCm: 240, draw: "Double", hasInsetHorizontal: true },
      BANDS,
      SPECS,
    );
    if (r.status !== "resolved") throw new Error("unresolved");
    expect(
      meshTrackSegments(r)
        .map((seg) => `${formatMmAsCm(seg.mm)} (${seg.label})`)
        .join(" + "),
    ).toBe(
      "6.5 (roller) + 4.3 (handle) + 217.9 (track) + 4.3 (handle) + 6.5 (roller) + 0.5 (inset)",
    );
  });

  it("always sums back to the window width", () => {
    for (const [widthCm, draw, inset] of [
      [240, "Double", false],
      [200, "Single Left", false],
      [150, "Single Left", true],
      [700, "Double", true],
    ] as const) {
      const r = resolveMeshTrack(
        { widthCm, draw, hasInsetHorizontal: inset },
        BANDS,
        SPECS,
      );
      if (r.status !== "resolved") throw new Error("unresolved");
      const total = meshTrackSegments(r).reduce((a, s) => a + s.mm, 0);
      expect(total).toBe(widthCm * 10);
    }
  });
});

describe("formatMmAsCm", () => {
  it("renders one decimal place only when there is one", () => {
    expect(formatMmAsCm(1852)).toBe("185.2");
    expect(formatMmAsCm(3340)).toBe("334");
    expect(formatMmAsCm(1784)).toBe("178.4");
  });
});

describe("meshSystemProblems", () => {
  it("reports every unbuildable panel with its position", () => {
    const problems = meshSystemProblems(
      [
        { panels: [{ widthCm: 200, draw: "Single Left" }] },
        {
          panels: [
            { widthCm: 400, draw: "Single Left" },
            { widthCm: 400, draw: "Double" },
            { widthCm: 900, draw: "Double" },
          ],
        },
      ],
      BANDS,
    );

    expect(problems.map((p) => [p.roomIndex, p.panelIndex])).toEqual([
      [1, 0],
      [1, 2],
    ]);
    expect(problems[0].message).toContain("double draw");
  });

  it("is empty when every panel resolves or is still blank", () => {
    expect(
      meshSystemProblems(
        [
          {
            panels: [
              { widthCm: 200, draw: "Single Left" },
              { widthCm: null, draw: undefined },
            ],
          },
        ],
        BANDS,
      ),
    ).toEqual([]);
  });
});
