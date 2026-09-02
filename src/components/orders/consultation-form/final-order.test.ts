import { describe, expect, it } from "vitest";

import { asFinalOrder } from "./final-order";

describe("asFinalOrder", () => {
  it("turns an edited draft into a final order without changing its fields", () => {
    expect(asFinalOrder({
      order: { is_draft: true, development: "The Botany" },
      rooms: [{ id: "room-1" }],
    })).toEqual({
      order: { is_draft: false, development: "The Botany" },
      rooms: [{ id: "room-1" }],
    });
  });
});
