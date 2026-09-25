import { describe, expect, it } from "vitest";

import {
  cutLengthMm,
  overlapTrackOrderLine,
  overlapTrackOrderText,
  pieceCount,
  sectionCount,
  trackOrderLine,
  trackOrderText,
  type TrackOrderLine,
} from "./track-order";
import {
  onStandardTrackOrder,
  type TrackOptions,
} from "./track-options";

const opts = (over: Partial<TrackOptions> = {}): TrackOptions => ({
  s_fold: false,
  slim_tracks: false,
  side_installation: false,
  overlap_tracks_attachment: false,
  ...over,
});

const line = (over: Partial<TrackOrderLine> = {}): TrackOrderLine => ({
  label: "Living Room — Window 1",
  widthCm: 266,
  kind: "double",
  options: opts(),
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

  it("says 单轨 for a single rail, one piece per section", () => {
    expect(trackOrderLine(line({ kind: "single" }))).toBe(
      "2.66米 单轨裁成1.33m 2根配连接器",
    );
  });

  it("marks a side-installed track as a cutting and installation instruction", () => {
    expect(
      trackOrderLine(line({ options: opts({ side_installation: true }) })),
    ).toBe(
      "2.66米 双轨裁成1.33m 4根配连接器 侧装 Side installation",
    );
  });

  it("keeps overlap attachments out of the base track order", () => {
    expect(
      trackOrderLine(
        line({ options: opts({ overlap_tracks_attachment: true }) }),
      ),
    ).toBe(
      "2.66米 双轨裁成1.33m 4根配连接器",
    );
  });

  it("keeps side installation on the base track order", () => {
    expect(
      trackOrderLine(
        line({
          options: opts({
            side_installation: true,
            overlap_tracks_attachment: true,
          }),
        }),
      ),
    ).toBe(
      "2.66米 双轨裁成1.33m 4根配连接器 侧装 Side installation",
    );
  });

  it("labels S-fold track orders separately", () => {
    expect(trackOrderLine(line({ options: opts({ s_fold: true }) }))).toBe(
      "2.66米 双轨裁成1.33m 4根配连接器 S-Fold",
    );
  });

  it("labels a slim-tracks rail without changing where it ships", () => {
    expect(
      trackOrderLine(line({ options: opts({ slim_tracks: true }) })),
    ).toBe("2.66米 双轨裁成1.33m 4根配连接器 Slim Tracks");
  });

  it("prints the option suffixes in registry order", () => {
    expect(
      trackOrderLine(
        line({ options: opts({ s_fold: true, slim_tracks: true }) }),
      ),
    ).toBe("2.66米 双轨裁成1.33m 4根配连接器 S-Fold Slim Tracks");
    expect(
      trackOrderLine(
        line({
          options: opts({ slim_tracks: true, side_installation: true }),
        }),
      ),
    ).toBe(
      "2.66米 双轨裁成1.33m 4根配连接器 Slim Tracks 侧装 Side installation",
    );
  });

  it("pads to two decimals, so a round width does not read as a typo", () => {
    expect(trackOrderLine(line({ widthCm: 300 }))).toBe(
      "3.00米 双轨裁成1.50m 4根配连接器",
    );
  });

  it("cuts a wide rail into three, not two over-length halves", () => {
    // 4.00 in two is 2.00 m a piece, which does not ship.
    expect(trackOrderLine(line({ widthCm: 400 }))).toBe(
      "4.00米 双轨裁成1.333m 6根配连接器",
    );
    expect(trackOrderLine(line({ widthCm: 400, kind: "single" }))).toBe(
      "4.00米 单轨裁成1.333m 3根配连接器",
    );
  });

  it("leaves a rail short enough to ship whole uncut", () => {
    expect(trackOrderLine(line({ widthCm: 120, kind: "single" }))).toBe(
      "1.20米 单轨裁成1.20m 1根配连接器",
    );
    expect(trackOrderLine(line({ widthCm: 120 }))).toBe(
      "1.20米 双轨裁成1.20m 2根配连接器",
    );
  });
});

describe("overlapTrackOrderText", () => {
  it("prints the full cut line plus the P6 attachment, for selected windows only", () => {
    const selected = line({
      options: opts({ overlap_tracks_attachment: true }),
    });
    expect(overlapTrackOrderLine(selected)).toBe(
      "2.66米 双轨裁成1.33m 4根配连接器 P6白色配交叉器",
    );
    expect(overlapTrackOrderText([line(), selected], "加固包装")).toBe(
      "2.66米 双轨裁成1.33m 4根配连接器 P6白色配交叉器\n加固包装",
    );
  });

  it("reproduces the business's example exactly", () => {
    expect(
      overlapTrackOrderLine(
        line({
          widthCm: 509,
          options: opts({ overlap_tracks_attachment: true }),
        }),
      ),
    ).toBe(
      "5.09米 双轨裁成1.273m 8根配连接器 P6白色配交叉器",
    );
  });

  it("keeps the P6 suffix after the S-Fold label", () => {
    expect(
      overlapTrackOrderLine(
        line({
          options: opts({ s_fold: true, overlap_tracks_attachment: true }),
        }),
      ),
    ).toBe(
      "2.66米 双轨裁成1.33m 4根配连接器 S-Fold P6白色配交叉器",
    );
  });

  it("keeps the P6 suffix after a side-installation instruction", () => {
    expect(
      overlapTrackOrderLine(
        line({
          options: opts({
            side_installation: true,
            overlap_tracks_attachment: true,
          }),
        }),
      ),
    ).toBe(
      "2.66米 双轨裁成1.33m 4根配连接器 侧装 Side installation P6白色配交叉器",
    );
  });

  it("keeps the P6 suffix after a slim-tracks label", () => {
    expect(
      overlapTrackOrderLine(
        line({
          options: opts({
            slim_tracks: true,
            overlap_tracks_attachment: true,
          }),
        }),
      ),
    ).toBe(
      "2.66米 双轨裁成1.33m 4根配连接器 Slim Tracks P6白色配交叉器",
    );
  });

  it("opens the notes with 侧装，需要L型角码 when a printed overlap line is side-installed", () => {
    expect(
      overlapTrackOrderText(
        [
          line({
            options: opts({
              side_installation: true,
              overlap_tracks_attachment: true,
            }),
          }),
        ],
        "加固包装",
      ),
    ).toBe(
      [
        "2.66米 双轨裁成1.33m 4根配连接器 侧装 Side installation P6白色配交叉器",
        "侧装，需要L型角码",
        "加固包装",
      ].join("\n"),
    );
  });

  it("stays unchanged when only an unprinted line is side-installed", () => {
    expect(
      overlapTrackOrderText(
        [
          line({ options: opts({ side_installation: true }) }),
          line({
            widthCm: 256,
            options: opts({ overlap_tracks_attachment: true }),
          }),
        ],
        "加固包装",
      ),
    ).toBe(
      "2.56米 双轨裁成1.28m 4根配连接器 P6白色配交叉器\n加固包装",
    );
  });
});

describe("sectionCount", () => {
  it("is one when the rail already fits in a piece", () => {
    expect(sectionCount(120)).toBe(1);
    expect(sectionCount(160)).toBe(1);
  });

  it("takes the fewest sections that keep every piece within 1.60 m", () => {
    expect(sectionCount(161)).toBe(2);
    expect(sectionCount(266)).toBe(2);
    // 3.20 in two is 1.60 exactly, and exactly 1.60 is allowed.
    expect(sectionCount(320)).toBe(2);
    expect(sectionCount(321)).toBe(3);
    expect(sectionCount(400)).toBe(3);
  });
});

describe("cutLengthMm", () => {
  it("divides the rail equally", () => {
    expect(cutLengthMm(266)).toBe(1330);
    expect(cutLengthMm(120)).toBe(1200);
  });

  it("keeps the millimetre rather than rounding to the centimetre", () => {
    // 2.55 in two is 1.275 — 1.28 would be 1 cm of rail per piece too much.
    expect(cutLengthMm(255)).toBe(1275);
    expect(cutLengthMm(400)).toBe(1333);
  });

  it("never yields a piece over the 1.60 m limit", () => {
    for (let widthCm = 1; widthCm <= 1200; widthCm++) {
      expect(cutLengthMm(widthCm)).toBeLessThanOrEqual(1600);
    }
  });
});

describe("pieceCount", () => {
  it("is one per section for a single rail", () => {
    expect(pieceCount(266, "single")).toBe(2);
    expect(pieceCount(400, "single")).toBe(3);
    expect(pieceCount(120, "single")).toBe(1);
  });

  it("is twice that for a double — the same cut, run twice", () => {
    expect(pieceCount(266, "double")).toBe(4);
    expect(pieceCount(400, "double")).toBe(6);
    expect(pieceCount(120, "double")).toBe(2);
  });
});

describe("trackOrderText", () => {
  const NOTE = "多配连接器和滑轨\n加固包装";

  it("opens the notes with 侧装，需要L型角码 when a line is side-installed", () => {
    expect(
      trackOrderText(
        [
          line({ options: opts({ side_installation: true }) }),
          line({ widthCm: 256 }),
        ],
        NOTE,
      ),
    ).toBe(
      [
        "2.66米 双轨裁成1.33m 4根配连接器 侧装 Side installation",
        "2.56米 双轨裁成1.28m 4根配连接器",
        "侧装，需要L型角码",
        "多配连接器和滑轨",
        "加固包装",
      ].join("\n"),
    );
  });

  it("prints the phrase once however many side-installed lines the block has", () => {
    const text = trackOrderText(
      [
        line({ options: opts({ side_installation: true }) }),
        line({ widthCm: 256, options: opts({ side_installation: true }) }),
      ],
      NOTE,
    );
    expect(text.split("侧装，需要L型角码")).toHaveLength(2);
    expect(text).toBe(
      [
        "2.66米 双轨裁成1.33m 4根配连接器 侧装 Side installation",
        "2.56米 双轨裁成1.28m 4根配连接器 侧装 Side installation",
        "侧装，需要L型角码",
        "多配连接器和滑轨",
        "加固包装",
      ].join("\n"),
    );
  });

  it("is unchanged when no line is side-installed", () => {
    expect(trackOrderText([line(), line({ widthCm: 256 })], NOTE)).toBe(
      [
        "2.66米 双轨裁成1.33m 4根配连接器",
        "2.56米 双轨裁成1.28m 4根配连接器",
        "多配连接器和滑轨",
        "加固包装",
      ].join("\n"),
    );
  });

  it("lets the phrase stand as the last line when there is no stored note", () => {
    const sideInstalled = line({
      options: opts({ side_installation: true }),
    });
    expect(trackOrderText([sideInstalled], null)).toBe(
      "2.66米 双轨裁成1.33m 4根配连接器 侧装 Side installation\n侧装，需要L型角码",
    );
    expect(trackOrderText([sideInstalled], "   ")).toBe(
      "2.66米 双轨裁成1.33m 4根配连接器 侧装 Side installation\n侧装，需要L型角码",
    );
  });

  it("lists every window, repeats and all, then the standing note", () => {
    // Straight off the sample order: one 2.66 and two identical 2.56s.
    expect(
      trackOrderText(
        [line(), line({ widthCm: 256 }), line({ widthCm: 256 })],
        "多配连接器和滑轨\n加固包装",
      ),
    ).toBe(
      [
        "2.66米 双轨裁成1.33m 4根配连接器",
        "2.56米 双轨裁成1.28m 4根配连接器",
        "2.56米 双轨裁成1.28m 4根配连接器",
        "多配连接器和滑轨",
        "加固包装",
      ].join("\n"),
    );
  });

  it("leaves an overlap window off the standard card — it is ordered there instead", () => {
    // The standard card's filter: a plain 2.75 and an overlap 2.77 print only
    // the 2.75, so the same rail is not ordered on both cards.
    const lines = [
      line({ widthCm: 275 }),
      line({
        widthCm: 277,
        options: opts({ overlap_tracks_attachment: true }),
      }),
    ];
    expect(
      trackOrderText(
        lines.filter((l) => onStandardTrackOrder(l.options)),
        "加固包装",
      ),
    ).toBe("2.75米 双轨裁成1.375m 4根配连接器\n加固包装");
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
