import { describe, expect, it } from "vitest";

import type { CogsRoom } from "./calculator";
import {
  cogsItemLabel,
  foldedRoomLabel,
  visibleCogsRooms,
} from "./cogs-breakdown";

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

// A room holding one window prints as one line: the room's subtotal and that
// window's figure are the same number, and saying it twice invites the reader
// to add them up.

describe("folding a one-window room", () => {
  it("is foldable when the room genuinely holds one item", () => {
    expect(visibleCogsRooms([room()])[0].foldable).toBe(true);
  });

  it("is NOT foldable when a second item was dropped for costing nothing", () => {
    // Window 1 is unpriced, so only window 2 survives the filter. Folding here
    // would print the room's name over window 2's figure with nothing saying
    // which window it is.
    const rooms = visibleCogsRooms([
      room({
        items: [
          { label: "Window 1", detail: null, rmbCents: 0 },
          { label: "Window 2", detail: "Essential", rmbCents: 12000 },
        ],
      }),
    ]);
    expect(rooms[0].foldable).toBe(false);
    expect(rooms[0].items.map((i) => i.label)).toEqual(["Window 2"]);
  });

  it("is not foldable with two real items", () => {
    expect(
      visibleCogsRooms([
        room({
          items: [
            { label: "Window 1", detail: "Essential", rmbCents: 6000 },
            { label: "Window 2", detail: "Essential", rmbCents: 6000 },
          ],
        }),
      ])[0].foldable,
    ).toBe(false);
  });
});

describe("foldedRoomLabel", () => {
  it("carries the window's series onto the room's line", () => {
    expect(
      foldedRoomLabel({ label: "Living Room" }, { detail: "Essential" }),
    ).toBe("Living Room · Essential");
  });

  it("is the room alone when the series is unknown", () => {
    expect(foldedRoomLabel({ label: "Living Room" }, { detail: null })).toBe(
      "Living Room",
    );
  });
});
