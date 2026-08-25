import { describe, expect, it } from "vitest";

import { shouldCollapse } from "./use-collapse-on-scroll";

// The complaint this pins: an open cost breakdown sits in a `sticky` panel, so
// it does not scroll away — on a four-room order it is taller than an iPhone SE
// viewport and hides every measurement field behind it. Scrolling has to end it.
//
// The threshold is the whole design. Too low and the breakdown snaps shut on
// the scroll that opening it can itself provoke, or on a thumb resting on the
// glass; too high and it overstays exactly when space is tightest.
describe("shouldCollapse", () => {
  const THRESHOLD = 48;

  it("stays open when the page has not moved", () => {
    expect(shouldCollapse(2000, 2000, THRESHOLD)).toBe(false);
  });

  it("survives a thumb twitch below the threshold", () => {
    expect(shouldCollapse(2030, 2000, THRESHOLD)).toBe(false);
  });

  it("survives the nudge that opening the panel can cause", () => {
    // Opening a details inside a sticky panel can shift the page a pixel or two.
    expect(shouldCollapse(2002, 2000, THRESHOLD)).toBe(false);
  });

  it("collapses once the user scrolls down past the threshold", () => {
    expect(shouldCollapse(2100, 2000, THRESHOLD)).toBe(true);
  });

  it("collapses scrolling UP too — either direction means moving on", () => {
    expect(shouldCollapse(1900, 2000, THRESHOLD)).toBe(true);
  });

  it("collapses exactly at the threshold", () => {
    expect(shouldCollapse(2048, 2000, THRESHOLD)).toBe(true);
    expect(shouldCollapse(2047, 2000, THRESHOLD)).toBe(false);
  });

  // Measured from where it was OPENED, not from the last event: a slow drift
  // down the form accumulates and closes it, rather than every small step
  // resetting the anchor and leaving it open forever.
  it("accumulates a slow drift rather than resetting each step", () => {
    const openedAt = 2000;
    const drift = [2010, 2020, 2030, 2040, 2050];
    const results = drift.map((y) => shouldCollapse(y, openedAt, THRESHOLD));
    expect(results).toEqual([false, false, false, false, true]);
  });
});
