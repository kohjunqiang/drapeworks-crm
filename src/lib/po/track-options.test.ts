import { describe, expect, it } from "vitest";

import {
  extraOrderSuffix,
  hasExtraOrder,
  railLineSuffix,
  railShipmentKind,
  resolveTrackOptions,
  trackOrderNotes,
  TRACK_OPTION_ADDON_KEYS,
  TRACK_OPTIONS,
  type TrackOptions,
} from "./track-options";

const opts = (over: Partial<TrackOptions> = {}): TrackOptions => ({
  s_fold: false,
  slim_tracks: false,
  side_installation: false,
  overlap_tracks_attachment: false,
  ...over,
});

describe("TRACK_OPTIONS", () => {
  it("registers the four options in rail-line order", () => {
    expect(TRACK_OPTIONS.map((option) => option.key)).toEqual([
      "s_fold",
      "slim_tracks",
      "side_installation",
      "overlap_tracks_attachment",
    ]);
  });

  it("names the pricing add-on keys a loader must fetch", () => {
    expect(TRACK_OPTION_ADDON_KEYS).toEqual(["s_fold", "slim_tracks"]);
  });
});

describe("resolveTrackOptions", () => {
  it("resolves add-on-sourced options from the window's keys", () => {
    expect(
      resolveTrackOptions({ addonKeys: ["s_fold", "slim_tracks", "blackout"] }),
    ).toEqual(opts({ s_fold: true, slim_tracks: true }));
  });

  it("resolves column-sourced options from the window's flags", () => {
    expect(
      resolveTrackOptions({
        addonKeys: [],
        sideInstallation: true,
        overlapTracksAttachment: true,
      }),
    ).toEqual(
      opts({ side_installation: true, overlap_tracks_attachment: true }),
    );
  });

  it("resolves nothing for a plain window", () => {
    expect(resolveTrackOptions({ addonKeys: [] })).toEqual(opts());
  });
});

describe("railShipmentKind", () => {
  it("routes an S-fold window to its own shipment", () => {
    expect(railShipmentKind(opts({ s_fold: true }))).toBe("s_fold_tracks");
  });

  it("keeps every other combination on the standard rail order", () => {
    expect(railShipmentKind(opts())).toBe("standard_tracks");
    expect(railShipmentKind(opts({ slim_tracks: true }))).toBe(
      "standard_tracks",
    );
    expect(
      railShipmentKind(
        opts({ slim_tracks: true, overlap_tracks_attachment: true }),
      ),
    ).toBe("standard_tracks");
  });
});

describe("railLineSuffix", () => {
  it("is empty for a plain rail", () => {
    expect(railLineSuffix(opts())).toBe("");
  });

  it("prints each label verbatim, in registry order", () => {
    expect(
      railLineSuffix(
        opts({ s_fold: true, slim_tracks: true, side_installation: true }),
      ),
    ).toBe(" S-Fold Slim Tracks 侧装 Side installation");
  });

  it("never labels the base line for the overlap attachment", () => {
    expect(railLineSuffix(opts({ overlap_tracks_attachment: true }))).toBe("");
  });
});

describe("extra order", () => {
  it("is ordered only when the overlap attachment is carried", () => {
    expect(hasExtraOrder(opts())).toBe(false);
    expect(hasExtraOrder(opts({ slim_tracks: true }))).toBe(false);
    expect(hasExtraOrder(opts({ overlap_tracks_attachment: true }))).toBe(true);
  });

  it("appends the attachment wording after the whole line", () => {
    expect(extraOrderSuffix(opts())).toBe("");
    expect(extraOrderSuffix(opts({ overlap_tracks_attachment: true }))).toBe(
      " P6白色配交叉器",
    );
  });
});

describe("trackOrderNotes", () => {
  it("prints a carried option's note first, ahead of the stored note", () => {
    expect(
      trackOrderNotes(
        [opts({ side_installation: true })],
        "多配连接器和滑轨\n加固包装",
      ),
    ).toEqual(["侧装，需要L型角码", "多配连接器和滑轨\n加固包装"]);
  });

  it("prints the note once however many lines carry the option", () => {
    expect(
      trackOrderNotes(
        [opts({ side_installation: true }), opts({ side_installation: true })],
        null,
      ),
    ).toEqual(["侧装，需要L型角码"]);
  });

  it("is just the stored note when no carried option asks for one", () => {
    expect(trackOrderNotes([opts()], "加固包装")).toEqual(["加固包装"]);
    expect(trackOrderNotes([opts({ slim_tracks: true })], "加固包装")).toEqual(
      ["加固包装"],
    );
    expect(
      trackOrderNotes([opts({ overlap_tracks_attachment: true })], "加固包装"),
    ).toEqual(["加固包装"]);
  });

  it("drops a missing or blank stored note rather than trailing an empty line", () => {
    expect(trackOrderNotes([opts()], null)).toEqual([]);
    expect(trackOrderNotes([opts()], "   ")).toEqual([]);
    expect(trackOrderNotes([opts({ side_installation: true })], null)).toEqual([
      "侧装，需要L型角码",
    ]);
    expect(trackOrderNotes([opts({ side_installation: true })], "  ")).toEqual([
      "侧装，需要L型角码",
    ]);
  });
});
