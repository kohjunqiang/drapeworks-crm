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
