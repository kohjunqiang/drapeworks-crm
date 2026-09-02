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
