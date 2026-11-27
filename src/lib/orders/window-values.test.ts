import { describe, expect, it } from "vitest";

import { windowValues } from "./window-values";

const DAY = "550e8400-e29b-41d4-a716-446655440000";
const NIGHT = "550e8400-e29b-41d4-a716-446655440001";
const BLIND = "550e8400-e29b-41d4-a716-446655440003";
const COMBO = "550e8400-e29b-41d4-a716-446655440004";

describe("windowValues — regular window", () => {
  it("writes day/night curtain type ids and draw, nulling blind columns", () => {
    const values = windowValues(
      {
        variant: "regular",
        width_cm: 120,
        height_cm: 240,
        notes: "beam clearance",
        day_curtain_type_id: DAY,
        night_curtain_type_id: NIGHT,
        draw: "Single Left",
      },
      2,
    );

    expect(values).toEqual({
      position: 2,
      label: null,
      track_only: false,
      track_kind: null,
      width_cm: 120,
      height_cm: 240,
      notes: "beam clearance",
      side_installation: false,
      no_installation: false,
      overlap_tracks_attachment: false,
      day_track_required: true,
      night_track_required: true,
      day_curtain_type_id: DAY,
      night_curtain_type_id: NIGHT,
      blind_type_id: null,
      draw: "Single Left",
      split_left_cm: null,
      split_right_cm: null,
      combo_id: null,
    });
  });

  it("maps no add-on columns — they are rows in window_addons now", () => {
    // The action writes them separately, after the window row. If they ever
    // reappear here it means someone has reintroduced the two-sources-of-truth
    // problem Phase 14 removed.
    const values = windowValues({ variant: "regular" }, 0);
    expect(values).not.toHaveProperty("add_s_fold");
    expect(values).not.toHaveProperty("add_slim_tracks");
    expect(values).not.toHaveProperty("curtain_type_id");
  });

  it("nulls unselected type ids and empty notes/measurements", () => {
    const values = windowValues({ variant: "regular" }, 0);
    expect(values.day_curtain_type_id).toBeNull();
    expect(values.night_curtain_type_id).toBeNull();
    expect(values.width_cm).toBeNull();
    expect(values.notes).toBeNull();
    expect(values.draw).toBeNull();
  });
});

describe("windowValues — blind window", () => {
  it("writes the blind type id and nulls every curtain column", () => {
    const values = windowValues(
      {
        variant: "blind",
        blind_type_id: BLIND,
        draw: "Single Right",
        width_cm: 150,
        height_cm: 200,
      },
      3,
    );

    expect(values).toEqual({
      position: 3,
      label: null,
      track_only: false,
      track_kind: null,
      width_cm: 150,
      height_cm: 200,
      notes: null,
      side_installation: false,
      no_installation: false,
      overlap_tracks_attachment: false,
      day_track_required: true,
      night_track_required: true,
      day_curtain_type_id: null,
      night_curtain_type_id: null,
      blind_type_id: BLIND,
      // Survives as the control side — the one curtain field a blind keeps.
      draw: "Single Right",
      split_left_cm: null,
      split_right_cm: null,
      combo_id: null,
    });
  });

  it("drops curtain ids and the combo when a curtain window is switched to a blind", () => {
    // The shape the form produces mid-switch: stale curtain values still
    // present alongside the new variant. Persisting any of them would violate
    // validate_window_shape() and leave a window that is both at once.
    const values = windowValues(
      {
        variant: "blind",
        blind_type_id: BLIND,
        day_curtain_type_id: DAY,
        night_curtain_type_id: NIGHT,
        combo_id: COMBO,
      },
      0,
    );

    expect(values.day_curtain_type_id).toBeNull();
    expect(values.night_curtain_type_id).toBeNull();
    expect(values.combo_id).toBeNull();
    expect(values.blind_type_id).toBe(BLIND);
  });

  it("drops the blind id when a blind window is switched back to curtains", () => {
    const regular = windowValues(
      { variant: "regular", blind_type_id: BLIND, day_curtain_type_id: DAY },
      0,
    );
    expect(regular.blind_type_id).toBeNull();
    expect(regular.day_curtain_type_id).toBe(DAY);
  });

  it("nulls an unselected blind and keeps the window otherwise empty", () => {
    const values = windowValues({ variant: "blind" }, 0);
    expect(values.blind_type_id).toBeNull();
    expect(values.draw).toBeNull();
    expect(values.width_cm).toBeNull();
  });

  it("persists side installation as an operational instruction", () => {
    const values = windowValues(
      { variant: "blind", side_installation: true },
      0,
    );
    expect(values.side_installation).toBe(true);
  });

  it("persists the overlap-track attachment as an operational instruction", () => {
    const values = windowValues(
      { variant: "regular", overlap_tracks_attachment: true },
      0,
    );
    expect(values.overlap_tracks_attachment).toBe(true);
  });

  it("drops a stale overlap-track instruction when switched to a blind", () => {
    const values = windowValues(
      { variant: "blind", overlap_tracks_attachment: true },
      0,
    );
    expect(values.overlap_tracks_attachment).toBe(false);
  });
});

describe("windowValues — unequal double draw", () => {
  it("persists both curtain leaf widths for a Double draw", () => {
    const values = windowValues(
      {
        variant: "regular",
        draw: "Double",
        width_cm: 300,
        split_left_cm: 120,
        split_right_cm: 180,
      },
      0,
    );

    expect(values.split_left_cm).toBe(120);
    expect(values.split_right_cm).toBe(180);
  });

  it("drops stale split widths for a single draw or blind", () => {
    expect(
      windowValues(
        {
          variant: "regular",
          draw: "Single Left",
          split_left_cm: 120,
          split_right_cm: 180,
        },
        0,
      ).split_left_cm,
    ).toBeNull();
    expect(
      windowValues(
        {
          variant: "blind",
          draw: "Single Right",
          split_left_cm: 120,
          split_right_cm: 180,
        },
        0,
      ).split_right_cm,
    ).toBeNull();
  });
});


describe("windowValues — no installation", () => {
  it("persists the flag on a curtain window", () => {
    expect(
      windowValues({ variant: "regular", no_installation: true }, 0)
        .no_installation,
    ).toBe(true);
  });

  it("persists the flag on a blind window — it is a window option, not a curtain one", () => {
    expect(
      windowValues({ variant: "blind", no_installation: true }, 0)
        .no_installation,
    ).toBe(true);
  });

  it("defaults to installed when the input omits the flag (legacy payloads)", () => {
    expect(windowValues({ variant: "regular" }, 0).no_installation).toBe(false);
    expect(windowValues({ variant: "blind" }, 0).no_installation).toBe(false);
  });

  it("keeps the flag through a variant switch — it is a covering-independent choice", () => {
    expect(
      windowValues(
        { variant: "blind", day_curtain_type_id: DAY, no_installation: true },
        0,
      ).no_installation,
    ).toBe(true);
  });
});

describe("window track requirements", () => {
  it("persists independent day/night choices and defaults existing inputs to new tracks", () => {
    expect(windowValues({ variant: "regular", day_track_required: false, night_track_required: true }, 0))
      .toMatchObject({ day_track_required: false, night_track_required: true });
    expect(windowValues({ variant: "regular" }, 0))
      .toMatchObject({ day_track_required: true, night_track_required: true });
  });
});

describe("windowValues — track-only window", () => {
  it("writes the rail count and nulls every covering column", () => {
    const values = windowValues(
      { variant: "track", track_kind: "double", width_cm: 300, label: "Balcony" },
      1,
    );

    expect(values).toEqual({
      position: 1,
      label: "Balcony",
      track_only: true,
      track_kind: "double",
      width_cm: 300,
      height_cm: null,
      notes: null,
      side_installation: false,
      // Installation is the only thing this window bills — the flag can
      // never persist, even if a stale payload carried it.
      no_installation: false,
      overlap_tracks_attachment: false,
      day_track_required: true,
      night_track_required: true,
      day_curtain_type_id: null,
      night_curtain_type_id: null,
      blind_type_id: null,
      draw: null,
      split_left_cm: null,
      split_right_cm: null,
      combo_id: null,
    });
  });

  it("a single track restates the count in day/night flags for curtain-counting consumers", () => {
    const values = windowValues({ variant: "track", track_kind: "single" }, 0);
    expect(values.track_kind).toBe("single");
    expect(values.day_track_required).toBe(true);
    expect(values.night_track_required).toBe(false);
  });

  it("defaults to a single rail when the kind is omitted", () => {
    const values = windowValues({ variant: "track", width_cm: 200 }, 0);
    expect(values.track_kind).toBe("single");
  });

  it("drops curtain and blind ids left over from a covering switch", () => {
    const values = windowValues(
      { variant: "track", day_curtain_type_id: DAY, night_curtain_type_id: NIGHT, blind_type_id: BLIND, combo_id: COMBO, draw: "Double" },
      0,
    );
    expect(values.day_curtain_type_id).toBeNull();
    expect(values.night_curtain_type_id).toBeNull();
    expect(values.blind_type_id).toBeNull();
    expect(values.combo_id).toBeNull();
    expect(values.draw).toBeNull();
  });

  it("forces no_installation off even when the input carries it", () => {
    expect(
      windowValues({ variant: "track", no_installation: true }, 0).no_installation,
    ).toBe(false);
  });

  it("keeps rail fittings like the overlap attachment", () => {
    expect(
      windowValues({ variant: "track", overlap_tracks_attachment: true }, 0)
        .overlap_tracks_attachment,
    ).toBe(true);
  });
});

describe("windowValues — window label", () => {
  it("trims and persists the label", () => {
    expect(
      windowValues({ variant: "regular", label: "  Bay window  " }, 0).label,
    ).toBe("Bay window");
  });

  it("stores null for a blank or missing label", () => {
    expect(windowValues({ variant: "regular", label: "   " }, 0).label).toBeNull();
    expect(windowValues({ variant: "regular" }, 0).label).toBeNull();
  });

  it("keeps the label through a covering switch — it names the opening, not the covering", () => {
    for (const variant of ["regular", "blind", "track"] as const) {
      expect(
        windowValues({ variant, label: "Sliding door", ...(variant === "track" ? { track_kind: "single" as const } : {}) }, 0).label,
      ).toBe("Sliding door");
    }
  });
});
