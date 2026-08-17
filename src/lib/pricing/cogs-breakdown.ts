// The presentation half of the cost breakdown — kept out of the calculators so
// pricing stays free of display rules, and shared by all three surfaces (the
// curtain live quote, the mesh live quote, and the saved-order quote card) so
// the breakdown reads the same everywhere.

import type { CogsItem, CogsRoom } from "./calculator";

/**
 * The rows worth showing: an item that cost nothing is a blank the consultant
 * hasn't filled in yet, not information, and a room left with nothing under it
 * goes too.
 *
 * A room that still carries cost keeps its row even if every item in it is
 * zero, so a subtotal never goes missing from the list it belongs to.
 */
export function visibleCogsRooms(rooms: CogsRoom[]): CogsRoom[] {
  return rooms
    .map((room) => ({
      ...room,
      items: room.items.filter((i) => i.rmbCents !== 0),
    }))
    .filter((room) => room.items.length > 0 || room.rmbCents !== 0);
}

/** "Window 1 · Essential + Signature", or just "Window 1" if unknown. */
export const cogsItemLabel = (item: CogsItem): string =>
  item.detail ? `${item.label} · ${item.detail}` : item.label;
