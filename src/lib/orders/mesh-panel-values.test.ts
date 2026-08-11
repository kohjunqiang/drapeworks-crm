import { describe, expect, it } from "vitest";

import { meshPanelValues } from "./mesh-panel-values";

describe("meshPanelValues", () => {
  it("maps every column and preserves the position", () => {
    const v = meshPanelValues(
      {
        category_id: "cat",
        colour_id: "col",
        width_cm: 240,
        height_cm: 150,
        depth_cm: 9,
        draw: "Single Left",
        notes: "tight reveal",
      },
      3,
    );
    expect(v).toEqual({
      position: 3,
      category_id: "cat",
      colour_id: "col",
      width_cm: 240,
      height_cm: 150,
      depth_cm: 9,
      draw: "Single Left",
      split_left_cm: null,
      split_right_cm: null,
      notes: "tight reveal",
    });
  });

  it("keeps the split for a double draw", () => {
    const v = meshPanelValues(
      {
        category_id: "cat",
        width_cm: 240,
        draw: "Double",
        split_left_cm: 60,
        split_right_cm: 180,
      },
      0,
    );
    expect(v.split_left_cm).toBe(60);
    expect(v.split_right_cm).toBe(180);
  });

  it("keeps a split that does not sum to the width", () => {
    // A 1 cm discrepancy on site must never be silently corrected — the
    // factory reads exactly what was measured.
    const v = meshPanelValues(
      {
        width_cm: 240,
        draw: "Double",
        split_left_cm: 60,
        split_right_cm: 179,
      },
      0,
    );
    expect(v.split_left_cm).toBe(60);
    expect(v.split_right_cm).toBe(179);
  });

  it("NULLS the split for every single draw, even if values were submitted", () => {
    // The form hides these fields, but the form is not the only writer. Stale
    // values from a draw the consultant changed their mind about must not
    // survive on the row.
    for (const draw of [
      "Single Left",
      "Single Right",
      "Single Top",
      "Single Bottom",
    ] as const) {
      const v = meshPanelValues(
        { draw, split_left_cm: 60, split_right_cm: 180 },
        0,
      );
      expect(v.split_left_cm, draw).toBeNull();
      expect(v.split_right_cm, draw).toBeNull();
    }
  });

  it("nulls the split when no draw is chosen at all", () => {
    const v = meshPanelValues({ split_left_cm: 60, split_right_cm: 180 }, 0);
    expect(v.draw).toBeNull();
    expect(v.split_left_cm).toBeNull();
    expect(v.split_right_cm).toBeNull();
  });

  it("maps a blank draft panel to all-null columns", () => {
    expect(meshPanelValues({}, 0)).toEqual({
      position: 0,
      category_id: null,
      colour_id: null,
      width_cm: null,
      height_cm: null,
      depth_cm: null,
      draw: null,
      split_left_cm: null,
      split_right_cm: null,
      notes: null,
    });
  });

  it("normalises an empty notes string to null", () => {
    expect(meshPanelValues({ notes: "" }, 0).notes).toBeNull();
  });
});
