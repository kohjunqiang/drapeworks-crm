import { describe, expect, it } from "vitest";

import {
  drawAfterCoveringChange,
  dropAfterCoveringChange,
} from "./covering-transition";

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

describe("dropAfterCoveringChange", () => {
  it("restores a legacy NULL drop verbatim across a blind round-trip", () => {
    // A window saved before the field (null = "Standard allowance") toggled
    // curtain → blind → curtain must come back null — not "default". Picking
    // Default here would silently swap configured allowance for −4 cm on a
    // window nobody edited.
    const blind = dropAfterCoveringChange("blind", null, null);
    expect(blind.curtainHeightPreference).toBeNull();

    const curtain = dropAfterCoveringChange(
      "curtain",
      null,
      blind.rememberedDrop,
    );
    expect(curtain.curtainHeightPreference).toBeNull();
    expect(curtain.rememberedDrop).toBeNull();
  });

  it("restores an explicit drop across a blind round-trip", () => {
    const blind = dropAfterCoveringChange("blind", "touch", "touch");
    expect(blind.curtainHeightPreference).toBeNull();

    expect(
      dropAfterCoveringChange("curtain", null, blind.rememberedDrop)
        .curtainHeightPreference,
    ).toBe("touch");
  });

  it("defaults a window that started as a blind to Default on first switch", () => {
    // undefined = no curtain state ever remembered — the new-window case,
    // where the approved default is the Default drop.
    const curtain = dropAfterCoveringChange("curtain", null, undefined);
    expect(curtain.curtainHeightPreference).toBe("default");
    expect(curtain.rememberedDrop).toBe("default");
  });

  it("remembers an authoritative CURRENT null over a stale remembered enum", () => {
    // Form init/reset can leave the remembered ref holding "default" while the
    // real field is the legacy null. Leaving curtains must remember the
    // current null — not resurrect "default" on the way back.
    const blind = dropAfterCoveringChange("blind", null, "default");
    expect(blind.curtainHeightPreference).toBeNull();
    expect(blind.rememberedDrop).toBeNull();

    expect(
      dropAfterCoveringChange("curtain", null, blind.rememberedDrop)
        .curtainHeightPreference,
    ).toBeNull();
  });

  it("clears the field on the switch to blind but keeps the memory", () => {
    const blind = dropAfterCoveringChange("blind", "cover_track", null);
    expect(blind.curtainHeightPreference).toBeNull();
    expect(blind.rememberedDrop).toBe("cover_track");
  });
});
