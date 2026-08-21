// The presentation half of the cost breakdown — kept out of the calculators so
// pricing stays free of display rules, and shared by all three surfaces (the
// curtain live quote, the mesh live quote, and the saved-order quote card) so
// the breakdown reads the same everywhere.

import type { CogsItem, CogsLeg, CogsRoom } from "./calculator";

/**
 * A room ready to render, plus whether its one item can be folded into it.
 *
 * `foldable` is decided BEFORE the zero-cost items are dropped, and that is the
 * whole point: a room whose second window is unpriced is left with one item,
 * but folding it away would print "Bedroom · Performance" over a figure that is
 * window 2's, with nothing saying so. Only a room that genuinely holds one
 * thing can be collapsed into one line.
 */
export type VisibleCogsRoom = CogsRoom & { foldable: boolean };

/**
 * The rows worth showing: an item that cost nothing is a blank the consultant
 * hasn't filled in yet, not information, and a room left with nothing under it
 * goes too.
 *
 * A room that still carries cost keeps its row even if every item in it is
 * zero, so a subtotal never goes missing from the list it belongs to.
 */
export function visibleCogsRooms(rooms: CogsRoom[]): VisibleCogsRoom[] {
  return rooms
    .map((room) => ({
      ...room,
      foldable: room.items.length === 1,
      items: room.items.filter((i) => i.rmbCents !== 0),
    }))
    .filter((room) => room.items.length > 0 || room.rmbCents !== 0);
}

/** "Window 1 · Essential + Signature", or just "Window 1" if unknown. */
export const cogsItemLabel = (item: CogsLeg): string =>
  item.detail ? `${item.label} · ${item.detail}` : item.label;

/**
 * A one-window room printed as one line: "Living Room · Essential + Signature".
 *
 * The room subtotal and its only window are the same number, and printing both
 * says it twice — on this order, four of the twelve rows were a room repeating
 * the single window under it. The window's own name ("Window 1") is what goes:
 * in a room with one window it identifies nothing.
 */
export const foldedRoomLabel = (
  room: Pick<CogsRoom, "label">,
  item: Pick<CogsItem, "detail">,
): string => (item.detail ? `${room.label} · ${item.detail}` : room.label);
