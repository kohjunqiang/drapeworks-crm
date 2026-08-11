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
  depth_cm?: number | null;
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
  depth_cm: number | null;
  draw: MeshDraw | null;
  split_left_cm: number | null;
  split_right_cm: number | null;
  notes: string | null;
};

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
    // Recess depth, measured on site. Never affects price.
    depth_cm: panel.depth_cm ?? null,
    draw: panel.draw ?? null,
    split_left_cm: isDouble ? (panel.split_left_cm ?? null) : null,
    split_right_cm: isDouble ? (panel.split_right_cm ?? null) : null,
    notes: panel.notes || null,
  };
}
