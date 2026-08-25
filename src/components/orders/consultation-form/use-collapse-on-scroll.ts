"use client";

import { useEffect, useRef } from "react";

/**
 * Has the page moved far enough from where the breakdown was opened to count as
 * the user moving on, rather than a thumb twitch or the scroll nudge that
 * opening the panel can itself cause?
 *
 * Pure so it can be tested without a DOM — the hook below is the only caller.
 */
export function shouldCollapse(
  scrollY: number,
  openedAtY: number,
  thresholdPx: number,
): boolean {
  return Math.abs(scrollY - openedAtY) >= thresholdPx;
}

/**
 * Collapses a `<details>` once the user scrolls away from where they opened it.
 *
 * The live-quote panel is `sticky top-2`, so an open cost breakdown does not
 * scroll off — it follows the consultant down the form. On a four-room order
 * that breakdown is ~560px tall, which is the whole of an iPhone SE viewport:
 * every measurement field is behind it and no amount of scrolling reveals one.
 * Opening it is a glance, not a mode, so the next scroll ends it.
 *
 * The threshold matters. Opening the panel can nudge the scroll position by a
 * pixel or two, and a phone reports scroll events for the smallest thumb
 * movement — closing on either would make the breakdown feel like it refuses to
 * stay open. A threshold of roughly one form row means only deliberate
 * navigation collapses it. Distance is measured from where the panel was
 * opened, not from the last event, so a slow drift closes it as surely as a
 * flick.
 *
 * Returns the ref to attach to the `<details>`.
 */
export function useCollapseOnScroll(thresholdPx = 48) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Where the page sat when the breakdown was opened.
    let openedAt = window.scrollY;

    const onToggle = () => {
      if (el.open) openedAt = window.scrollY;
    };

    const onScroll = () => {
      if (!el.open) return;
      if (!shouldCollapse(window.scrollY, openedAt, thresholdPx)) return;
      el.open = false;
    };

    el.addEventListener("toggle", onToggle);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("toggle", onToggle);
      window.removeEventListener("scroll", onScroll);
    };
  }, [thresholdPx]);

  return ref;
}
