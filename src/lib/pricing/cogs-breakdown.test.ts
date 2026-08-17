import { describe, expect, it } from "vitest";

import type { CogsRoom } from "./calculator";
import { cogsItemLabel, visibleCogsRooms } from "./cogs-breakdown";

const room = (over: Partial<CogsRoom> = {}): CogsRoom => ({
  label: "Living Room",
  rmbCents: 12000,
  items: [{ label: "Window 1", detail: "Essential", rmbCents: 12000 }],
  ...over,
});

describe("visibleCogsRooms", () => {
  it("drops windows that cost nothing — a blank row isn't information", () => {
    const rooms = visibleCogsRooms([
      room({
        items: [
          { label: "Window 1", detail: "Essential", rmbCents: 12000 },
          { label: "Window 2", detail: null, rmbCents: 0 },
        ],
      }),
    ]);
    expect(rooms[0].items.map((i) => i.label)).toEqual(["Window 1"]);
  });

  it("drops a room once nothing is left under it", () => {
    const rooms = visibleCogsRooms([
      room(),
      room({
        label: "Empty",
        rmbCents: 0,
        items: [{ label: "Window 1", detail: null, rmbCents: 0 }],
      }),
    ]);
    expect(rooms.map((r) => r.label)).toEqual(["Living Room"]);
  });

  it("keeps a room that still carries cost, so no subtotal goes missing", () => {
    const rooms = visibleCogsRooms([
      room({ rmbCents: 500, items: [] }),
    ]);
    expect(rooms).toHaveLength(1);
  });

  it("leaves the input untouched", () => {
    const input = [
      room({
        items: [
          { label: "Window 1", detail: null, rmbCents: 12000 },
          { label: "Window 2", detail: null, rmbCents: 0 },
        ],
      }),
    ];
    visibleCogsRooms(input);
    expect(input[0].items).toHaveLength(2);
  });
});

describe("cogsItemLabel", () => {
  it("appends the series when there is one", () => {
    expect(
      cogsItemLabel({ label: "Window 1", detail: "Essential", rmbCents: 1 }),
    ).toBe("Window 1 · Essential");
  });

  it("is the item's name alone when the series is unknown", () => {
    expect(cogsItemLabel({ label: "Window 1", detail: null, rmbCents: 1 })).toBe(
      "Window 1",
    );
  });
});
