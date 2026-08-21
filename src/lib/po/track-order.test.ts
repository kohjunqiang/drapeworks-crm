import { describe, expect, it } from "vitest";

import {
  cutLengthCm,
  pieceCount,
  trackOrderLine,
  trackOrderText,
  type TrackOrderLine,
} from "./track-order";

const line = (over: Partial<TrackOrderLine> = {}): TrackOrderLine => ({
  label: "Living Room — Window 1",
  widthCm: 266,
  kind: "double",
  ...over,
});

describe("trackOrderLine", () => {
  // The line the wording was transcribed from.
  it("reproduces the sample line exactly", () => {
    expect(trackOrderLine(line())).toBe("2.66米 双轨裁成1.33m 4根配连接器");
  });

  it("reproduces the sample's other width", () => {
    expect(trackOrderLine(line({ widthCm: 256 }))).toBe(
      "2.56米 双轨裁成1.28m 4根配连接器",
    );
  });

  it("says 单轨 for a single rail, and two pieces", () => {
    expect(trackOrderLine(line({ kind: "single" }))).toBe(
      "2.66米 单轨裁成1.33m 2根配连接器",
    );
  });

  it("pads to two decimals, so a round width does not read as a typo", () => {
    expect(trackOrderLine(line({ widthCm: 300 }))).toBe(
      "3.00米 双轨裁成1.50m 4根配连接器",
    );
  });
});

describe("cutLengthCm", () => {
  it("halves the opening", () => {
    expect(cutLengthCm(266)).toBe(133);
  });

  it("rounds an odd width UP — long is trimmed, short is a second delivery", () => {
    expect(cutLengthCm(267)).toBe(134);
  });
});

describe("pieceCount", () => {
  it("is four for a double rail — two runs, each cut in half to ship", () => {
    expect(pieceCount("double")).toBe(4);
  });

  it("is two for a single", () => {
    expect(pieceCount("single")).toBe(2);
  });
});

describe("trackOrderText", () => {
  it("lists every window, repeats and all, then the standing note", () => {
    // Straight off the sample order: one 2.66 and two identical 2.56s.
    expect(
      trackOrderText(
        [
          line(),
          line({ widthCm: 256 }),
          line({ widthCm: 256 }),
        ],
        "多陪连接器和滑轨\n加固包装",
      ),
    ).toBe(
      [
        "2.66米 双轨裁成1.33m 4根配连接器",
        "2.56米 双轨裁成1.28m 4根配连接器",
        "2.56米 双轨裁成1.28m 4根配连接器",
        "多陪连接器和滑轨",
        "加固包装",
      ].join("\n"),
    );
  });

  it("leaves the note off when there is none, rather than trailing a blank line", () => {
    expect(trackOrderText([line()], null)).toBe(
      "2.66米 双轨裁成1.33m 4根配连接器",
    );
    expect(trackOrderText([line()], "   ")).toBe(
      "2.66米 双轨裁成1.33m 4根配连接器",
    );
  });

  it("is empty when there is nothing to order — not a lone note", () => {
    expect(trackOrderText([], "加固包装")).toBe("");
  });
});
