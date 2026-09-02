import { describe, expect, it } from "vitest";

import { drawAfterCoveringChange } from "./covering-transition";

describe("drawAfterCoveringChange", () => {
  it("clears Double for a blind and restores Double when returning to curtains", () => {
    const blind = drawAfterCoveringChange("blind", "Double", undefined);
    const curtain = drawAfterCoveringChange(
      "curtain",
      "Single Left",
      blind.rememberedCurtainDraw,
    );

    expect(blind.draw).toBeUndefined();
    expect(curtain.draw).toBe("Double");
  });

  it.each(["Single Left", "Single Right"] as const)(
    "restores the curtain's %s draw even if the blind side changes",
    (draw) => {
      const blind = drawAfterCoveringChange("blind", draw, undefined);
      const changedBlindSide =
        draw === "Single Left" ? "Single Right" : "Single Left";

      expect(blind.draw).toBe(draw);
      expect(
        drawAfterCoveringChange(
          "curtain",
          changedBlindSide,
          blind.rememberedCurtainDraw,
        ).draw,
      ).toBe(draw);
    },
  );

  it("defaults an existing blind to Double when first changed to curtains", () => {
    expect(
      drawAfterCoveringChange("curtain", "Single Left", undefined).draw,
    ).toBe("Double");
  });
});
