import { Fragment } from "react";

import type { CogsExtra, CogsRoom } from "@/lib/pricing/calculator";
import { cogsItemLabel, visibleCogsRooms } from "@/lib/pricing/cogs-breakdown";

const rmb = (cents: number) => `¥${(cents / 100).toFixed(2)}`;

/**
 * The COGS half of a cost breakdown: a subtotal per room with its windows (or
 * mesh panels) indented beneath, each named by what it's made of and split into
 * its legs where it has more than one, then the order-level lines (the rails)
 * that belong to no single window.
 *
 * Emits bare <dt>/<dd> rows — the caller owns the <dl>. The markups that follow
 * are `CostBreakdown`'s job.
 */
export function CogsRoomRows({
  rooms,
  extras = [],
}: {
  rooms: CogsRoom[];
  extras?: CogsExtra[];
}) {
  return (
    <>
      {visibleCogsRooms(rooms).map((room, roomIdx) => (
        <Fragment key={roomIdx}>
          <div className="flex justify-between gap-2 text-slate-600">
            <dt className="truncate">{room.label}</dt>
            <dd className="whitespace-nowrap">{rmb(room.rmbCents)}</dd>
          </div>
          {room.items.map((item, itemIdx) => (
            <Fragment key={itemIdx}>
              <div className="flex justify-between gap-2 pl-3 text-slate-400">
                <dt className="truncate">{cogsItemLabel(item)}</dt>
                <dd className="whitespace-nowrap">{rmb(item.rmbCents)}</dd>
              </div>
              {/* What the window is made of — the day curtain, the night
                  curtain, the S-Fold over them. Only present when there is
                  more than one, so a single-covering window doesn't print its
                  own figure twice. */}
              {(item.legs ?? []).map((leg, legIdx) => (
                <div
                  key={legIdx}
                  className="flex justify-between gap-2 pl-6 text-slate-400/80"
                >
                  <dt className="truncate">{cogsItemLabel(leg)}</dt>
                  <dd className="whitespace-nowrap">{rmb(leg.rmbCents)}</dd>
                </div>
              ))}
            </Fragment>
          ))}
        </Fragment>
      ))}

      {/* The rails, counted once for the whole order rather than hidden inside
          each window's figure — they're bought by the piece and never billed. */}
      {extras
        .filter((e) => e.rmbCents !== 0)
        .map((extra) => (
          <div
            key={extra.label}
            className="flex justify-between gap-2 text-slate-600"
          >
            <dt className="truncate">
              {extra.label}
              <span className="text-slate-400"> × {extra.count}</span>
            </dt>
            <dd className="whitespace-nowrap">{rmb(extra.rmbCents)}</dd>
          </div>
        ))}
    </>
  );
}
