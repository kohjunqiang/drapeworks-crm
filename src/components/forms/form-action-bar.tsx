import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Persistent action bar for long forms. Below md the row renders with exactly
 * the classes the caller passes — `className` is the entire mobile layout.
 * At md+ the row pins to the bottom edge of the nearest scrolling ancestor:
 * the viewport for page forms, or the scrolling body of a dialog, so the
 * primary save action stays visible at the first, middle and final scroll
 * positions. Sticky confines the bar to its own form — it unpins at the end
 * of the form rather than overlapping whatever follows on the page.
 */
export function FormActionBar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "md:sticky md:bottom-0 md:z-10 md:rounded-lg md:border md:border-slate-200 md:bg-white/95 md:px-4 md:py-3 md:backdrop-blur",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * The same pin for the action row of a form inside a scrolling dialog body,
 * styled as a full-bleed footer strip like DialogFooter/SheetFooter rather
 * than a floating card. `-mx-4`/`-mb-4`/`-bottom-4` match the standard p-4
 * dialog content padding (the same bleed DialogFooter uses): the negative
 * sticky bottom lets the pinned bar cover the panel's padding strip so no
 * scrolled fields show beneath it. Pass the matching offsets (e.g.
 * `md:-mx-5 md:-mb-5 md:-bottom-5 md:px-5`) via className when the
 * surrounding panel pads differently.
 */
export function DialogActionBar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "md:sticky md:-bottom-4 md:z-10 md:-mx-4 md:-mb-4 md:rounded-b-xl md:border-t md:border-slate-200 md:bg-white md:px-4 md:py-3",
        className,
      )}
    >
      {children}
    </div>
  );
}
