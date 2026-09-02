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
      width_cm: 120,
      height_cm: 240,
      notes: "beam clearance",
      side_installation: false,
      day_curtain_type_id: DAY,
      night_curtain_type_id: NIGHT,
      blind_type_id: null,
      draw: "Single Left",
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
      width_cm: 150,
      height_cm: 200,
      notes: null,
      side_installation: false,
      day_curtain_type_id: null,
      night_curtain_type_id: null,
      blind_type_id: BLIND,
      // Survives as the control side — the one curtain field a blind keeps.
      draw: "Single Right",
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
});
