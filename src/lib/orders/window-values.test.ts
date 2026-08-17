import { describe, expect, it } from "vitest";

import { windowValues } from "./window-values";

const DAY = "550e8400-e29b-41d4-a716-446655440000";
const NIGHT = "550e8400-e29b-41d4-a716-446655440001";
const TOILET = "550e8400-e29b-41d4-a716-446655440002";
const BLIND = "550e8400-e29b-41d4-a716-446655440003";
const COMBO = "550e8400-e29b-41d4-a716-446655440004";

describe("windowValues — regular window", () => {
  it("writes day/night curtain type ids and draw, nulling toilet columns", () => {
    const values = windowValues(
      {
        variant: "regular",
        width_cm: 120,
        height_cm: 240,
        install_width_cm: 130,
        notes: "beam clearance",
        day_curtain_type_id: DAY,
        night_curtain_type_id: NIGHT,
        draw: "Single Left",
      },
      2,
    );

    expect(values).toEqual({
      position: 2,
      width_cm: 120,
      height_cm: 240,
      install_width_cm: 130,
      notes: "beam clearance",
      day_curtain_type_id: DAY,
      night_curtain_type_id: NIGHT,
      curtain_type_id: null,
      blind_type_id: null,
      draw: "Single Left",
      add_s_fold: false,
      add_slim_tracks: false,
      combo_id: null,
    });
  });

  it("passes through the S-Fold / Slim-tracks toggles", () => {
    const values = windowValues(
      { variant: "regular", add_s_fold: true, add_slim_tracks: true },
      0,
    );
    expect(values.add_s_fold).toBe(true);
    expect(values.add_slim_tracks).toBe(true);
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

describe("windowValues — toilet window", () => {
  it("writes the single curtain type id and nulls regular-only columns", () => {
    const values = windowValues(
      { variant: "toilet", curtain_type_id: TOILET, width_cm: 60 },
      1,
    );
    expect(values).toEqual({
      position: 1,
      width_cm: 60,
      height_cm: null,
      install_width_cm: null,
      notes: null,
      curtain_type_id: TOILET,
      day_curtain_type_id: null,
      night_curtain_type_id: null,
      blind_type_id: null,
      draw: null,
      add_s_fold: false,
      add_slim_tracks: false,
      combo_id: null,
    });
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
      width_cm: 150,
      height_cm: 200,
      install_width_cm: null,
      notes: null,
      curtain_type_id: null,
      day_curtain_type_id: null,
      night_curtain_type_id: null,
      blind_type_id: BLIND,
      // Survives as the control side — the one curtain field a blind keeps.
      draw: "Single Right",
      add_s_fold: false,
      add_slim_tracks: false,
      combo_id: null,
    });
  });

  it("drops curtain ids, add-ons and the combo when a curtain window is switched to a blind", () => {
    // The shape the form produces mid-switch: stale curtain values still
    // present alongside the new variant. Persisting any of them would violate
    // validate_window_shape() and leave a window that is both at once.
    const values = windowValues(
      {
        variant: "blind",
        blind_type_id: BLIND,
        day_curtain_type_id: DAY,
        night_curtain_type_id: NIGHT,
        curtain_type_id: TOILET,
        add_s_fold: true,
        add_slim_tracks: true,
        combo_id: COMBO,
      },
      0,
    );

    expect(values.day_curtain_type_id).toBeNull();
    expect(values.night_curtain_type_id).toBeNull();
    expect(values.curtain_type_id).toBeNull();
    expect(values.add_s_fold).toBe(false);
    expect(values.add_slim_tracks).toBe(false);
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

    const toilet = windowValues(
      { variant: "toilet", blind_type_id: BLIND, curtain_type_id: TOILET },
      0,
    );
    expect(toilet.blind_type_id).toBeNull();
    expect(toilet.curtain_type_id).toBe(TOILET);
  });

  it("nulls an unselected blind and keeps the window otherwise empty", () => {
    const values = windowValues({ variant: "blind" }, 0);
    expect(values.blind_type_id).toBeNull();
    expect(values.draw).toBeNull();
    expect(values.width_cm).toBeNull();
  });
});
