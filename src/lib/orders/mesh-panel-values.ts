import type { MESH_DRAW_VALUES } from "@/lib/validation/mesh";

type MeshDraw = (typeof MESH_DRAW_VALUES)[number];

// The subset of validated-panel fields the DB mapping reads. Accepts create,
// edit and draft panel shapes structurally so all three persistence paths share
// one mapping — the same arrangement as windowValues for curtains.
export type MeshPanelLike = {
  category_id?: string;
  colour_id?: string;
  width_cm?: number | null;
  height_cm?: number | null;
  has_window?: boolean;
  has_inset?: boolean;
  draw?: MeshDraw;
  split_left_cm?: number | null;
  split_right_cm?: number | null;
  notes?: string;
};

export type MeshPanelColumnValues = {
  position: number;
  category_id: string | null;
  colour_id: string | null;
  width_cm: number | null;
  height_cm: number | null;
  has_window: boolean;
  has_inset: boolean;
  draw: MeshDraw | null;
  split_left_cm: number | null;
  split_right_cm: number | null;
  notes: string | null;
};

/**
 * What the handyman screws the frame to. Derived from `has_window` rather than
 * stored alongside it — one fact, one column. The mesh fixes to the window
 * grille; an opening with no window has no grille, so it goes to the wall.
 */
export function meshMountSurface(hasWindow: boolean): string {
  return hasWindow ? "Window grille" : "Wall";
}

export function meshPanelValues(
  panel: MeshPanelLike,
  position: number,
): MeshPanelColumnValues {
  // Only a double draw splits into two leaves. Everything else has no split,
  // and stale values from a draw the consultant changed their mind about must
  // not survive on the row — the factory reads these.
  //
  // Enforced HERE, server-side, rather than by the form hiding the fields: the
  // form is not the only writer.
  const isDouble = panel.draw === "Double";

  return {
    position,
    category_id: panel.category_id ?? null,
    colour_id: panel.colour_id ?? null,
    width_cm: panel.width_cm ?? null,
    height_cm: panel.height_cm ?? null,
    // Whether there is a window, and therefore a grille to screw the frame to.
    // Absent means yes — the normal installation, matching the column default.
    has_window: panel.has_window ?? true,
    // Set into the wall: make it to size, no overhang. Absent means no inset.
    has_inset: panel.has_inset ?? false,
    draw: panel.draw ?? null,
    split_left_cm: isDouble ? (panel.split_left_cm ?? null) : null,
    split_right_cm: isDouble ? (panel.split_right_cm ?? null) : null,
    notes: panel.notes || null,
  };
}
