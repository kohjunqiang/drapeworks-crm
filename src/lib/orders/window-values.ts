import type { DRAW_DIRECTION_VALUES } from "@/lib/validation/order";

type DrawDirection = (typeof DRAW_DIRECTION_VALUES)[number];

// The subset of validated-window fields the DB mapping reads. Accepts create,
// edit, and draft window shapes structurally so all three persistence paths
// share one mapping.
export type WindowLike = {
  variant: "regular" | "toilet";
  width_cm?: number | null;
  height_cm?: number | null;
  install_width_cm?: number | null;
  notes?: string;
  curtain_type_id?: string;
  day_curtain_type_id?: string;
  night_curtain_type_id?: string;
  draw?: DrawDirection;
};

// Every column on public.windows that the shape trigger cares about. A uniform
// shape for both variants keeps the insert/update call sites simple: the
// opposite variant's columns are always explicitly nulled so the
// validate_window_shape() trigger is satisfied when a room switches type.
export type WindowColumnValues = {
  position: number;
  width_cm: number | null;
  height_cm: number | null;
  install_width_cm: number | null;
  notes: string | null;
  curtain_type_id: string | null;
  day_curtain_type_id: string | null;
  night_curtain_type_id: string | null;
  draw: DrawDirection | null;
  // Option A: fabric codes are no longer written from the form. Kept as
  // explicit nulls so converting a legacy window doesn't leave stale codes.
  curtain_code: string | null;
  day_curtain_code: string | null;
  night_curtain_code: string | null;
};

export function windowValues(
  win: WindowLike,
  position: number,
): WindowColumnValues {
  const base = {
    position,
    width_cm: win.width_cm ?? null,
    height_cm: win.height_cm ?? null,
    install_width_cm: win.install_width_cm ?? null,
    notes: win.notes || null,
    curtain_code: null,
    day_curtain_code: null,
    night_curtain_code: null,
  } as const;

  if (win.variant === "toilet") {
    return {
      ...base,
      curtain_type_id: win.curtain_type_id ?? null,
      day_curtain_type_id: null,
      night_curtain_type_id: null,
      draw: null,
    };
  }

  return {
    ...base,
    curtain_type_id: null,
    day_curtain_type_id: win.day_curtain_type_id ?? null,
    night_curtain_type_id: win.night_curtain_type_id ?? null,
    draw: win.draw ?? null,
  };
}
