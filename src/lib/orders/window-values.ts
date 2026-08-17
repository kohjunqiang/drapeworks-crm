import type { DRAW_DIRECTION_VALUES } from "@/lib/validation/order";

type DrawDirection = (typeof DRAW_DIRECTION_VALUES)[number];

// The subset of validated-window fields the DB mapping reads. Accepts create,
// edit, and draft window shapes structurally so all three persistence paths
// share one mapping.
export type WindowLike = {
  variant: "regular" | "toilet" | "blind";
  width_cm?: number | null;
  height_cm?: number | null;
  notes?: string;
  curtain_type_id?: string;
  day_curtain_type_id?: string;
  night_curtain_type_id?: string;
  blind_type_id?: string;
  draw?: DrawDirection;
  add_s_fold?: boolean;
  add_slim_tracks?: boolean;
  combo_id?: string;
};

// Every column on public.windows that the shape trigger cares about. A uniform
// shape for both variants keeps the insert/update call sites simple: the
// opposite variant's columns are always explicitly nulled so the
// validate_window_shape() trigger is satisfied when a room switches type.
export type WindowColumnValues = {
  position: number;
  width_cm: number | null;
  height_cm: number | null;
  notes: string | null;
  curtain_type_id: string | null;
  day_curtain_type_id: string | null;
  night_curtain_type_id: string | null;
  blind_type_id: string | null;
  draw: DrawDirection | null;
  add_s_fold: boolean;
  add_slim_tracks: boolean;
  combo_id: string | null;
};

export function windowValues(
  win: WindowLike,
  position: number,
): WindowColumnValues {
  const base = {
    position,
    width_cm: win.width_cm ?? null,
    height_cm: win.height_cm ?? null,
    notes: win.notes || null,
  } as const;

  // A blind occupies the window INSTEAD of curtains, so every curtain column is
  // nulled — including the add-ons and the combo, which are curtain hardware and
  // curtain bundles. `draw` survives: for a blind it carries the control side.
  // Blinds are valid in every room type, so this branch comes before the toilet
  // check rather than inside it.
  if (win.variant === "blind") {
    return {
      ...base,
      curtain_type_id: null,
      day_curtain_type_id: null,
      night_curtain_type_id: null,
      blind_type_id: win.blind_type_id ?? null,
      draw: win.draw ?? null,
      add_s_fold: false,
      add_slim_tracks: false,
      combo_id: null,
    };
  }

  if (win.variant === "toilet") {
    return {
      ...base,
      curtain_type_id: win.curtain_type_id ?? null,
      day_curtain_type_id: null,
      night_curtain_type_id: null,
      blind_type_id: null,
      draw: null,
      // Toilet windows don't offer these curtain treatments.
      add_s_fold: false,
      add_slim_tracks: false,
      combo_id: null,
    };
  }

  return {
    ...base,
    curtain_type_id: null,
    day_curtain_type_id: win.day_curtain_type_id ?? null,
    night_curtain_type_id: win.night_curtain_type_id ?? null,
    blind_type_id: null,
    draw: win.draw ?? null,
    add_s_fold: win.add_s_fold ?? false,
    add_slim_tracks: win.add_slim_tracks ?? false,
    combo_id: win.combo_id ?? null,
  };
}
