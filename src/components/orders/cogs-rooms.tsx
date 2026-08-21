import { Fragment } from "react";

import type { CogsExtra, CogsLeg, CogsRoom } from "@/lib/pricing/calculator";
import {
  cogsItemLabel,
  foldedRoomLabel,
  visibleCogsRooms,
} from "@/lib/pricing/cogs-breakdown";

const rmb = (cents: number) => `¥${(cents / 100).toFixed(2)}`;

/** One leg of a window — the day curtain, the S-Fold over it — indented under it. */
function Legs({ legs, className }: { legs: CogsLeg[]; className: string }) {
  return (
    <>
      {legs.map((leg, i) => (
        <div key={i} className={`flex justify-between gap-2 ${className}`}>
          <dt className="truncate">{cogsItemLabel(leg)}</dt>
          <dd className="whitespace-nowrap">{rmb(leg.rmbCents)}</dd>
        </div>
      ))}
    </>
  );
}

/**
 * The COGS half of a cost breakdown: a subtotal per room with its windows (or
 * mesh panels) indented beneath, each named by what it's made of and split into
 * its legs where it has more than one, then the order-level lines (the rails)
 * that belong to no single window.
 *
 * A room holding ONE window is printed as a single line. The room's subtotal
 * and that window's figure are the same number, and a list that says ¥438.00
 * twice running invites the reader to add them up.
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
      {visibleCogsRooms(rooms).map((room, roomIdx) => {
        const only = room.foldable ? room.items[0] : undefined;

        return (
          <Fragment key={roomIdx}>
            <div className="flex justify-between gap-2 text-slate-600">
              <dt className="truncate">
                {only ? foldedRoomLabel(room, only) : room.label}
              </dt>
              <dd className="whitespace-nowrap">{rmb(room.rmbCents)}</dd>
            </div>

            {/* Folded: the window's legs hang off the room itself. */}
            {only ? (
              <Legs legs={only.legs ?? []} className="pl-3 text-slate-400" />
            ) : (
              room.items.map((item, itemIdx) => (
                <Fragment key={itemIdx}>
                  <div className="flex justify-between gap-2 pl-3 text-slate-400">
                    <dt className="truncate">{cogsItemLabel(item)}</dt>
                    <dd className="whitespace-nowrap">{rmb(item.rmbCents)}</dd>
                  </div>
                  {/* What the window is made of — the day curtain, the night
                      curtain, the S-Fold over them. Only present when there is
                      more than one, so a single-covering window doesn't print
                      its own figure twice. */}
                  <Legs
                    legs={item.legs ?? []}
                    className="pl-6 text-slate-400/80"
                  />
                </Fragment>
              ))
            )}
          </Fragment>
        );
      })}

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
