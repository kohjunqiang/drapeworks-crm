import { describe, expect, it } from "vitest";

import type { CogsLine } from "./calculator";
import { COGS_LABELS, visibleCogsLines } from "./cogs-labels";

describe("visibleCogsLines", () => {
  it("drops components that cost nothing", () => {
    const lines: CogsLine[] = [
      { key: "curtains", rmbCents: 28560 },
      { key: "blinds", rmbCents: 0 },
      { key: "s_fold", rmbCents: 3080 },
      { key: "slim_tracks", rmbCents: 0 },
      { key: "track", rmbCents: 2500 },
    ];
    expect(visibleCogsLines(lines).map((l) => l.key)).toEqual([
      "curtains",
      "s_fold",
      "track",
    ]);
  });

  it("keeps one row when every component is zero, so the section isn't headless", () => {
    // Real case: a category priced for sale but with no cost configured.
    const lines: CogsLine[] = [
      { key: "mesh", rmbCents: 0 },
      { key: "colour", rmbCents: 0 },
      { key: "double_draw", rmbCents: 0 },
    ];
    expect(visibleCogsLines(lines)).toEqual([{ key: "mesh", rmbCents: 0 }]);
  });

  it("labels every key an engine can emit", () => {
    const keys: CogsLine["key"][] = [
      "curtains",
      "blinds",
      "s_fold",
      "slim_tracks",
      "track",
      "mesh",
      "colour",
      "double_draw",
    ];
    for (const k of keys) expect(COGS_LABELS[k]).toBeTruthy();
  });
});
