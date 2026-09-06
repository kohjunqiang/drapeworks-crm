import { describe, expect, it } from "vitest";

import {
  meshDrawIsDouble,
  meshOrderCreateSchema,
  meshOrderDraftSchema,
  meshPanelSchema,
} from "./mesh";

const UUID = "11111111-1111-4111-8111-111111111111";

const panel = (over: Record<string, unknown> = {}) => ({
  position: 0,
  category_id: UUID,
  colour_id: UUID,
  width_cm: 120,
  height_cm: 150,
  draw: "Single Left",
  ...over,
});

const order = (over: Record<string, unknown> = {}) => ({
  customer: { name: "Tan", mobile: "9123 4567" },
  order: {},
  rooms: [{ type: "Living Room", label: "Living", position: 0, panels: [panel()] }],
  ...over,
});

describe("meshPanelSchema", () => {
  it("accepts a fully specified panel", () => {
    expect(meshPanelSchema.safeParse(panel()).success).toBe(true);
  });

  it("accepts a blank panel — drafts save half-finished", () => {
    const r = meshPanelSchema.safeParse({ position: 0 });
    expect(r.success).toBe(true);
  });

  it("normalises empty-string selects to undefined, not a uuid error", () => {
    const r = meshPanelSchema.safeParse(
      panel({ category_id: "", colour_id: "" }),
    );
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.category_id).toBeUndefined();
      expect(r.data.colour_id).toBeUndefined();
    }
  });

  it("coerces measurement strings from the form to numbers", () => {
    const r = meshPanelSchema.safeParse(
      panel({ width_cm: "120", height_cm: "150" }),
    );
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.width_cm).toBe(120);
      expect(r.data.height_cm).toBe(150);
    }
  });

  it("defaults the mount to the window grille when unstated", () => {
    const r = meshPanelSchema.safeParse(panel());
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.has_window).toBe(true);
  });

  it("accepts a bare opening that fixes to the wall", () => {
    const r = meshPanelSchema.safeParse(panel({ has_window: false }));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.has_window).toBe(false);
  });

  it("defaults both inset axes to false", () => {
    const r = meshPanelSchema.safeParse(panel());
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.has_inset_horizontal).toBe(false);
      expect(r.data.has_inset_vertical).toBe(false);
    }
  });

  it("accepts each inset axis independently", () => {
    // They constrain different things, so one must not imply the other.
    const h = meshPanelSchema.safeParse(panel({ has_inset_horizontal: true }));
    expect(h.success).toBe(true);
    if (h.success) {
      expect(h.data.has_inset_horizontal).toBe(true);
      expect(h.data.has_inset_vertical).toBe(false);
    }

    const both = meshPanelSchema.safeParse(
      panel({ has_inset_horizontal: true, has_inset_vertical: true }),
    );
    expect(both.success).toBe(true);
    if (both.success) expect(both.data.has_inset_vertical).toBe(true);
  });

  it("rejects a measurement beyond the 1000 cm sanity cap", () => {
    expect(meshPanelSchema.safeParse(panel({ width_cm: 100000 })).success).toBe(
      false,
    );
  });

  it("accepts all five draw directions and rejects a curtain-only one", () => {
    for (const draw of [
      "Single Left",
      "Single Right",
      "Single Top",
      "Single Bottom",
      "Double",
    ]) {
      expect(meshPanelSchema.safeParse(panel({ draw })).success).toBe(true);
    }
    // "Double Left" is not a mesh draw.
    expect(meshPanelSchema.safeParse(panel({ draw: "Double Left" })).success).toBe(
      false,
    );
  });

  it("does NOT reject a split that fails to sum to the width", () => {
    // Deliberate: a 1 cm discrepancy on site must never block a consultant.
    // The form warns; the schema accepts.
    const r = meshPanelSchema.safeParse(
      panel({ draw: "Double", width_cm: 240, split_left_cm: 60, split_right_cm: 179 }),
    );
    expect(r.success).toBe(true);
  });
});

describe("meshDrawIsDouble", () => {
  it("is true only for Double", () => {
    expect(meshDrawIsDouble("Double")).toBe(true);
    expect(meshDrawIsDouble("Single Left")).toBe(false);
    expect(meshDrawIsDouble(undefined)).toBe(false);
  });
});

describe("meshOrderCreateSchema", () => {
  it("accepts a minimal complete order", () => {
    expect(meshOrderCreateSchema.safeParse(order()).success).toBe(true);
  });

  it("carries a valid template room id used to copy photos", () => {
    const input = order();
    input.rooms[0] = { ...input.rooms[0], template_room_id: UUID } as typeof input.rooms[0];
    const parsed = meshOrderCreateSchema.parse(input);
    expect(parsed.rooms[0].template_room_id).toBe(UUID);
  });

  it("rejects a malformed template room id", () => {
    const input = order();
    input.rooms[0] = { ...input.rooms[0], template_room_id: "not-a-uuid" } as typeof input.rooms[0];
    expect(meshOrderCreateSchema.safeParse(input).success).toBe(false);
  });

  it("defaults mesh freight to sea without changing the shared curtain default", () => {
    const input = order();
    delete (input.order as { freight_mode?: string }).freight_mode;
    const parsed = meshOrderCreateSchema.parse(input);
    expect(parsed.order.freight_mode).toBe("sea");
  });

  it("requires at least one room", () => {
    expect(meshOrderCreateSchema.safeParse(order({ rooms: [] })).success).toBe(
      false,
    );
  });

  it("requires at least one panel per room", () => {
    const r = meshOrderCreateSchema.safeParse(
      order({
        rooms: [{ type: "Bedroom", label: "Bed 1", position: 0, panels: [] }],
      }),
    );
    expect(r.success).toBe(false);
  });

  it("enforces the Singapore mobile format", () => {
    const r = meshOrderCreateSchema.safeParse(
      order({ customer: { name: "Tan", mobile: "12345" } }),
    );
    expect(r.success).toBe(false);
  });

  it("has no product_line field — it cannot be set through the schema", () => {
    const r = meshOrderCreateSchema.safeParse({
      ...order(),
      order: { product_line: "curtain" },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect("product_line" in r.data.order).toBe(false);
    }
  });
});

describe("meshOrderDraftSchema", () => {
  it("accepts a draft with only a customer name and no rooms", () => {
    const r = meshOrderDraftSchema.safeParse({
      customer: { name: "Tan" },
      order: {},
      rooms: [],
    });
    expect(r.success).toBe(true);
  });

  it("still requires a customer name", () => {
    const r = meshOrderDraftSchema.safeParse({
      customer: { name: "" },
      order: {},
      rooms: [],
    });
    expect(r.success).toBe(false);
  });
});
