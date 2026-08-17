import { describe, expect, it } from "vitest";

import { windowSchema } from "./order";

const UUID = "550e8400-e29b-41d4-a716-446655440000";

describe("windowSchema — curtain type ids (option A)", () => {
  it("accepts a regular window with day/night curtain type ids", () => {
    const parsed = windowSchema.parse({
      variant: "regular",
      position: 0,
      day_curtain_type_id: UUID,
      night_curtain_type_id: UUID,
    });
    expect(parsed).toMatchObject({
      variant: "regular",
      day_curtain_type_id: UUID,
      night_curtain_type_id: UUID,
    });
  });

  it("accepts a toilet window with a single curtain type id", () => {
    const parsed = windowSchema.parse({
      variant: "toilet",
      position: 0,
      curtain_type_id: UUID,
    });
    expect(parsed).toMatchObject({ variant: "toilet", curtain_type_id: UUID });
  });

  it("treats an empty-string select value as no selection", () => {
    const parsed = windowSchema.parse({
      variant: "regular",
      position: 0,
      day_curtain_type_id: "",
      night_curtain_type_id: "",
    });
    expect(parsed).toMatchObject({
      day_curtain_type_id: undefined,
      night_curtain_type_id: undefined,
    });
  });

  it("is valid when no curtain type is selected at all", () => {
    expect(() =>
      windowSchema.parse({ variant: "regular", position: 0 }),
    ).not.toThrow();
  });

  it("rejects a malformed curtain type id", () => {
    expect(() =>
      windowSchema.parse({
        variant: "toilet",
        position: 0,
        curtain_type_id: "not-a-uuid",
      }),
    ).toThrow();
  });
});

const BLIND = "550e8400-e29b-41d4-a716-446655440003";

describe("windowSchema — blind windows", () => {
  it("accepts a blind window with a control side", () => {
    const parsed = windowSchema.parse({
      variant: "blind",
      position: 0,
      blind_type_id: BLIND,
      draw: "Single Left",
    });
    expect(parsed).toMatchObject({
      variant: "blind",
      blind_type_id: BLIND,
      draw: "Single Left",
    });
  });

  it("strips curtain fields from a blind window — never both", () => {
    // The union member has no day/night/curtain keys at all, so Zod drops them
    // rather than carrying a window that is a curtain and a blind at once.
    const parsed = windowSchema.parse({
      variant: "blind",
      position: 0,
      blind_type_id: BLIND,
      day_curtain_type_id: UUID,
      night_curtain_type_id: UUID,
      curtain_type_id: UUID,
      add_s_fold: true,
      combo_id: UUID,
    });
    expect(parsed).not.toHaveProperty("day_curtain_type_id");
    expect(parsed).not.toHaveProperty("night_curtain_type_id");
    expect(parsed).not.toHaveProperty("curtain_type_id");
    expect(parsed).not.toHaveProperty("add_s_fold");
    expect(parsed).not.toHaveProperty("combo_id");
  });

  it("rejects Double as a control side — a blind has no two leaves", () => {
    expect(() =>
      windowSchema.parse({
        variant: "blind",
        position: 0,
        blind_type_id: BLIND,
        draw: "Double",
      }),
    ).toThrow();
  });

  it("still accepts Double on a curtain window", () => {
    expect(() =>
      windowSchema.parse({ variant: "regular", position: 0, draw: "Double" }),
    ).not.toThrow();
  });

  it("is valid when no blind is selected yet", () => {
    expect(() =>
      windowSchema.parse({ variant: "blind", position: 0 }),
    ).not.toThrow();
  });

  it("rejects a malformed blind type id", () => {
    expect(() =>
      windowSchema.parse({
        variant: "blind",
        position: 0,
        blind_type_id: "not-a-uuid",
      }),
    ).toThrow();
  });
});
