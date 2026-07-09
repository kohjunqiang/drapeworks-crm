import { describe, expect, it } from "vitest";

import { curtainTypeSchema } from "./curtain-type";

const SERIES = "550e8400-e29b-41d4-a716-446655440000";

describe("curtainTypeSchema", () => {
  it("accepts a new Day curtain type with a series", () => {
    const parsed = curtainTypeSchema.parse({
      isNew: true,
      label: "Sheer Ivory",
      category: "Day",
      series_id: SERIES,
    });
    expect(parsed.label).toBe("Sheer Ivory");
    expect(parsed.category).toBe("Day");
    expect(parsed.series_id).toBe(SERIES);
    expect(parsed.photo_path).toBeUndefined();
  });

  it("accepts an edit carrying an id, a photo path and a page", () => {
    const parsed = curtainTypeSchema.parse({
      isNew: false,
      id: "550e8400-e29b-41d4-a716-446655440001",
      label: "Blackout Charcoal",
      category: "Night",
      series_id: SERIES,
      page: "P12a",
      photo_path: "curtain-types/abc/def.jpg",
      photo_mime: "image/jpeg",
    });
    expect(parsed.id).toBe("550e8400-e29b-41d4-a716-446655440001");
    expect(parsed.page).toBe("P12a");
  });

  it("requires a series", () => {
    expect(() =>
      curtainTypeSchema.parse({ isNew: true, label: "x", category: "Day" }),
    ).toThrow();
  });

  it("rejects a page that does not start with P", () => {
    expect(() =>
      curtainTypeSchema.parse({
        isNew: true,
        label: "x",
        category: "Day",
        series_id: SERIES,
        page: "12",
      }),
    ).toThrow();
  });

  it("treats an empty page as no page", () => {
    const parsed = curtainTypeSchema.parse({
      isNew: true,
      label: "x",
      category: "Day",
      series_id: SERIES,
      page: "",
    });
    expect(parsed.page).toBeUndefined();
  });

  it("rejects an empty label", () => {
    expect(() =>
      curtainTypeSchema.parse({
        isNew: true,
        label: "",
        category: "Day",
        series_id: SERIES,
      }),
    ).toThrow();
  });

  it("rejects a label longer than 120 chars", () => {
    expect(() =>
      curtainTypeSchema.parse({
        isNew: true,
        label: "x".repeat(121),
        category: "Day",
        series_id: SERIES,
      }),
    ).toThrow();
  });

  it("rejects a category outside Day/Night", () => {
    expect(() =>
      curtainTypeSchema.parse({
        isNew: true,
        label: "x",
        category: "Both",
        series_id: SERIES,
      }),
    ).toThrow();
  });

  it("rejects a non-uuid id", () => {
    expect(() =>
      curtainTypeSchema.parse({
        isNew: false,
        id: "not-a-uuid",
        label: "x",
        category: "Day",
        series_id: SERIES,
      }),
    ).toThrow();
  });
});
