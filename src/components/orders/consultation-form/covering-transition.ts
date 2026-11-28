import type { CurtainHeightPreference } from "@/lib/curtain-height-preference";

export type WindowDraw = "Double" | "Single Left" | "Single Right";

export type CoveringDrawTransition = {
  draw: WindowDraw | undefined;
  rememberedCurtainDraw: WindowDraw;
};

/** Keep the curtain draw independent from a blind's control side. */
export function drawAfterCoveringChange(
  next: "curtain" | "blind",
  current: WindowDraw | undefined,
  rememberedCurtainDraw: WindowDraw | undefined,
): CoveringDrawTransition {
  if (next === "blind") {
    return {
      draw: current === "Double" ? undefined : current,
      rememberedCurtainDraw: current ?? rememberedCurtainDraw ?? "Double",
    };
  }

  const draw = rememberedCurtainDraw ?? "Double";
  return { draw, rememberedCurtainDraw: draw };
}

export type CoveringDropTransition = {
  curtainHeightPreference: CurtainHeightPreference | null;
  rememberedDrop: CurtainHeightPreference | null;
};

/**
 * Keep a curtain window's saved drop independent from a blind.
 *
 * Three states matter and must not collapse into two:
 * - rememberedDrop === null  — a curtain on the legacy "Standard allowance"
 *   (no saved drop). Toggling blind → curtain must restore NULL, not pick
 *   Default: manufacturing height is original + configured allowance, and
 *   silently rewriting it to −4 cm would change the dimension of a window
 *   nobody edited.
 * - rememberedDrop === enum  — an explicit drop, restored verbatim.
 * - rememberedDrop === undefined — no curtain state was ever seen (a window
 *   that started life as a blind). Only here does the new-window Default
 *   apply.
 */
export function dropAfterCoveringChange(
  next: "curtain" | "blind",
  current: CurtainHeightPreference | null | undefined,
  rememberedDrop: CurtainHeightPreference | null | undefined,
): CoveringDropTransition {
  if (next === "blind") {
    return {
      curtainHeightPreference: null,
      // CURRENT is authoritative when the field is present — an explicit null
      // (legacy "Standard allowance") must be remembered as null, not fall
      // through to a stale remembered enum. Only an absent field (undefined)
      // may lean on the remembered value. The select writes "" for its
      // NONE item, which is the same "no saved drop" state as null.
      rememberedDrop:
        current === undefined ? (rememberedDrop ?? null) : current || null,
    };
  }

  const drop = rememberedDrop === undefined ? "default" : rememberedDrop;
  return { curtainHeightPreference: drop, rememberedDrop: drop };
}
