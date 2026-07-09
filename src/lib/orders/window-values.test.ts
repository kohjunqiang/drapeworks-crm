import { describe, expect, it } from "vitest";

import { windowValues } from "./window-values";

const DAY = "550e8400-e29b-41d4-a716-446655440000";
const NIGHT = "550e8400-e29b-41d4-a716-446655440001";
const TOILET = "550e8400-e29b-41d4-a716-446655440002";

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
      draw: "Single Left",
    });
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
      draw: null,
    });
  });
});
