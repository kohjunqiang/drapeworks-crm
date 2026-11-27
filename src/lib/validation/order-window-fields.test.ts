import { describe, expect, it } from "vitest";

import { customerSchema, windowSchema } from "./order";

describe("windowSchema — track-only variant", () => {
  it("accepts a rail with kind, width, label and notes — no covering fields", () => {
    const parsed = windowSchema.parse({
      variant: "track",
      position: 0,
      track_kind: "double",
      width_cm: 300,
      label: "Balcony",
      notes: "above the sliding door",
    });
    expect(parsed).toMatchObject({
      variant: "track",
      track_kind: "double",
      width_cm: 300,
      label: "Balcony",
      no_installation: false,
    });
  });

  it("requires an explicit track kind — the rail count is never guessed", () => {
    expect(
      windowSchema.safeParse({ variant: "track", position: 0, width_cm: 300 })
        .success,
    ).toBe(false);
  });

  it("cannot opt out of installation — install is the only thing it bills", () => {
    expect(
      windowSchema.safeParse({
        variant: "track",
        position: 0,
        track_kind: "single",
        no_installation: true,
      }).success,
    ).toBe(false);
  });

  it("strips a curtain field leaking onto the track variant", () => {
    // The union admits the track branch — but the fabric id is dropped, not
    // carried: it can never reappear as a covering on this window.
    const parsed = windowSchema.parse({
      variant: "track",
      position: 0,
      track_kind: "single",
      day_curtain_type_id: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(parsed.variant).toBe("track");
    expect(parsed).not.toHaveProperty("day_curtain_type_id");
  });
});

describe("windowSchema — editable label", () => {
  it("accepts and trims a label on every variant", () => {
    for (const variant of [
      { variant: "regular" },
      { variant: "blind" },
      { variant: "track", track_kind: "single" },
    ]) {
      const parsed = windowSchema.parse({
        ...variant,
        position: 0,
        label: "  Bay window ",
      });
      expect(parsed.label).toBe("Bay window");
    }
  });

  it("caps the label at 120 characters", () => {
    expect(
      windowSchema.safeParse({
        variant: "regular",
        position: 0,
        label: "x".repeat(121),
      }).success,
    ).toBe(false);
    expect(
      windowSchema.safeParse({
        variant: "regular",
        position: 0,
        label: "x".repeat(120),
      }).success,
    ).toBe(true);
  });
});

describe("customerSchema — salutation", () => {
  const base = { name: "Jia Jun", mobile: "91234567" };

  it("accepts a preset or custom title up to the Zoho 25-character limit", () => {
    expect(
      customerSchema.parse({ ...base, salutation: "Dr" }).salutation,
    ).toBe("Dr");
    expect(
      customerSchema.parse({ ...base, salutation: "Prof. Hendricks" })
        .salutation,
    ).toBe("Prof. Hendricks");
    expect(
      customerSchema.parse({ ...base, salutation: "x".repeat(25) }).salutation,
    ).toBe("x".repeat(25));
  });

  it("rejects a title beyond 25 characters — the Zoho Books cap", () => {
    expect(
      customerSchema.safeParse({ ...base, salutation: "x".repeat(26) }).success,
    ).toBe(false);
  });

  it("is optional and never defaults — no guessed title", () => {
    expect(customerSchema.parse(base).salutation).toBeUndefined();
  });

  it("trims whitespace around a custom entry", () => {
    expect(
      customerSchema.parse({ ...base, salutation: "  Mx.  " }).salutation,
    ).toBe("Mx.");
  });
});
