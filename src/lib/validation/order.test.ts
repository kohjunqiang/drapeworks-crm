import { describe, expect, it } from "vitest";

import { orderCreateSchema, orderDraftSchema, windowSchema } from "./order";

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

  it("rejects the retired toilet variant — a toilet window is a blind", () => {
    const r = windowSchema.safeParse({
      variant: "toilet",
      position: 0,
      curtain_type_id: UUID,
    });
    expect(r.success).toBe(false);
  });

  it("carries addon_ids on either variant, defaulting to none", () => {
    expect(
      windowSchema.parse({ variant: "regular", position: 0, addon_ids: [UUID] }),
    ).toMatchObject({ addon_ids: [UUID] });
    expect(
      windowSchema.parse({ variant: "blind", position: 0, addon_ids: [UUID] }),
    ).toMatchObject({ addon_ids: [UUID] });
    expect(
      windowSchema.parse({ variant: "blind", position: 0 }).addon_ids,
    ).toEqual([]);
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
        variant: "regular",
        position: 0,
        day_curtain_type_id: "not-a-uuid",
      }),
    ).toThrow();
  });

  it("rejects a malformed add-on id", () => {
    expect(() =>
      windowSchema.parse({
        variant: "blind",
        position: 0,
        addon_ids: ["not-a-uuid"],
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
      combo_id: UUID,
    });
    expect(parsed).not.toHaveProperty("day_curtain_type_id");
    expect(parsed).not.toHaveProperty("night_curtain_type_id");
    expect(parsed).not.toHaveProperty("combo_id");
    // addon_ids IS carried on a blind — Phase 14 gave blinds add-ons. Scope is
    // what keeps a curtain add-on off one, and that lives in the resolver.
    expect(parsed).toHaveProperty("addon_ids");
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

describe("windowSchema — unequal double draw", () => {
  it("accepts left and right widths that add up to the total", () => {
    const parsed = windowSchema.parse({
      variant: "regular",
      position: 0,
      draw: "Double",
      width_cm: 300,
      split_left_cm: 120,
      split_right_cm: 180,
    });
    expect(parsed).toMatchObject({ split_left_cm: 120, split_right_cm: 180 });
  });

  it("keeps an ordinary Double draw valid with no explicit split", () => {
    expect(
      windowSchema.safeParse({
        variant: "regular",
        position: 0,
        draw: "Double",
        width_cm: 300,
      }).success,
    ).toBe(true);
  });

  it.each([
    { split_left_cm: 120 },
    { split_right_cm: 180 },
    { split_left_cm: 120, split_right_cm: 170 },
  ])("rejects an incomplete or mismatched split: %j", (split) => {
    expect(
      windowSchema.safeParse({
        variant: "regular",
        position: 0,
        draw: "Double",
        width_cm: 300,
        ...split,
      }).success,
    ).toBe(false);
  });

  it("does not strand a user when switching from Double to a single draw", () => {
    expect(
      windowSchema.safeParse({
        variant: "regular",
        position: 0,
        draw: "Single Left",
        width_cm: 300,
        split_left_cm: 120,
        split_right_cm: 180,
      }).success,
    ).toBe(true);
  });
});

const APPOINTMENT = "550e8400-e29b-41d4-a716-446655440009";

const MINIMAL_ORDER = {
  customer: { name: "Tan Wei Ming", mobile: "9123 4567" },
  order: { site_address: "12 Lynwood Grove, Singapore 358172" },
  rooms: [
    {
      type: "Living Room",
      label: "Living Room",
      position: 0,
      windows: [{ variant: "regular", position: 0 }],
    },
  ],
};

// Phase 15 — a consultation started from a booked appointment carries that
// appointment's id so the write path can reuse its customer instead of
// inserting a second row for the same person.
describe("orderCreateSchema / orderDraftSchema — appointment_id", () => {
  it("carries a valid template room id used to copy photos", () => {
    const parsed = orderCreateSchema.parse({
      ...MINIMAL_ORDER,
      rooms: [{ ...MINIMAL_ORDER.rooms[0], template_room_id: UUID }],
    });
    expect(parsed.rooms[0].template_room_id).toBe(UUID);
  });

  it("rejects a malformed template room id", () => {
    const parsed = orderCreateSchema.safeParse({
      ...MINIMAL_ORDER,
      rooms: [{ ...MINIMAL_ORDER.rooms[0], template_room_id: "not-a-uuid" }],
    });
    expect(parsed.success).toBe(false);
  });

  it("requires the installation address before creating an order", () => {
    expect(
      orderCreateSchema.safeParse({
        ...MINIMAL_ORDER,
        order: { ...MINIMAL_ORDER.order, site_address: "" },
      }).success,
    ).toBe(false);
  });

  it("carries an appointment id through a create", () => {
    const parsed = orderCreateSchema.parse({
      ...MINIMAL_ORDER,
      appointment_id: APPOINTMENT,
    });
    expect(parsed.appointment_id).toBe(APPOINTMENT);
  });

  it("is optional — a walk-in consultation has no appointment", () => {
    const parsed = orderCreateSchema.parse(MINIMAL_ORDER);
    expect(parsed.appointment_id).toBeUndefined();
  });

  it("rejects a malformed appointment id", () => {
    const r = orderCreateSchema.safeParse({
      ...MINIMAL_ORDER,
      appointment_id: "not-a-uuid",
    });
    expect(r.success).toBe(false);
  });

  it("carries it through a draft save too", () => {
    const parsed = orderDraftSchema.parse({
      customer: { name: "Tan Wei Ming" },
      order: {},
      rooms: [],
      appointment_id: APPOINTMENT,
    });
    expect(parsed.appointment_id).toBe(APPOINTMENT);
  });
});

describe("orderCreateSchema / orderDraftSchema — lead_id", () => {
  it("carries a direct Attend Appointment lead link", () => {
    const parsed = orderCreateSchema.parse({ ...MINIMAL_ORDER, lead_id: APPOINTMENT });
    expect(parsed.lead_id).toBe(APPOINTMENT);
  });

  it("rejects a free-text lead status or identifier", () => {
    expect(orderCreateSchema.safeParse({ ...MINIMAL_ORDER, lead_id: "Attend Appointment" }).success).toBe(false);
  });

  it("carries the lead link through a draft", () => {
    const parsed = orderDraftSchema.parse({ customer: { name: "Tan Wei Ming" }, order: {}, rooms: [], lead_id: APPOINTMENT });
    expect(parsed.lead_id).toBe(APPOINTMENT);
  });
});

describe("orderCreateSchema / orderDraftSchema — customer_id", () => {
  it("accepts an existing customer id for a repeat quote", () => {
    const customerId = crypto.randomUUID();
    expect(orderCreateSchema.parse({ ...MINIMAL_ORDER, customer_id: customerId }).customer_id)
      .toBe(customerId);
    expect(orderDraftSchema.parse({
      customer: { name: "Tan Wei Ming" },
      order: {},
      rooms: [],
      customer_id: customerId,
    }).customer_id).toBe(customerId);
  });
});
