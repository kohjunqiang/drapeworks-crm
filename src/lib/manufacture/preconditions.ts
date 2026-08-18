// Everything that has to be true before an order's manufacturing measurements
// can be frozen and the order handed to a vendor.
//
// Pure on purpose, so it can run anywhere.
//
// HONESTY NOTE: today only the confirm action calls this. The reconciliation
// screen re-derives the same rules in its own client code rather than importing
// it. The two agree — each rule was checked case by case — but they agree by
// coincidence of two authors, not by construction. If you change a rule here,
// change it in src/components/manufacture/reconciliation-row.tsx too, or the
// screen will start promising something the action refuses. Wiring the screen
// to this function is the real fix and is worth doing.

import type { FulfilmentStatus } from "@/lib/db/schema";
import { STATUS_LABELS } from "@/lib/status-flow";

import {
  applyAllowance,
  isManufacturable,
  resolveAllowance,
  type AllowanceBook,
  type AllowanceLine,
} from "./allowance";
import type { ManufactureLine } from "./load";

/** What a human typed for one line. Shaped to match the confirm payload's lines. */
export type LineOverride = {
  overrideWidthCm?: number | null;
  overrideHeightCm?: number | null;
  overrideReason?: string | null;
};

/** Overrides keyed by `ManufactureLine.lineId`. */
export type OverrideMap = ReadonlyMap<string, LineOverride>;

export type PreconditionResult =
  | { ok: true }
  | { ok: false; reasons: string[] };

// Manufacturing measurements are derived between taking the money and placing
// the vendor order. Any other status means someone is on the wrong screen.
const CONFIRMABLE_FROM: FulfilmentStatus = "deposit_received";

const LINE_LABELS: Record<AllowanceLine, string> = {
  curtain: "Curtain",
  blind: "Blind",
  mesh: "Mesh",
};

// Room label verbatim — it is what the consultant wrote on site, and it is how
// whoever has to fix the problem will find the piece.
function locate(line: ManufactureLine): string {
  const noun = line.kind === "window" ? "Window" : "Panel";
  // position is 0-based in the database; every screen shows it 1-based. A
  // message naming "window 0" sends the reader looking for a row that does not
  // exist on the page they are staring at.
  return `${line.roomLabel} ${noun} ${line.position + 1}`;
}

export function checkConfirmPreconditions(
  lines: ManufactureLine[],
  book: AllowanceBook,
  status: FulfilmentStatus,
  overrides: OverrideMap,
): PreconditionResult {
  const reasons: string[] = [];

  if (status !== CONFIRMABLE_FROM) {
    reasons.push(
      `This order is at "${STATUS_LABELS[status]}". Manufacturing measurements can only be confirmed from "${STATUS_LABELS[CONFIRMABLE_FROM]}".`,
    );
  }

  if (lines.length === 0) {
    reasons.push("This order has nothing to manufacture.");
  }

  for (const line of lines) {
    const override = overrides.get(line.lineId);
    const overridden =
      override?.overrideWidthCm != null || override?.overrideHeightCm != null;

    const allowance = resolveAllowance(book, line.line);
    if (!allowance) {
      // Deduplicated below: one unconfigured line would otherwise repeat this
      // once per affected piece.
      reasons.push(
        `${LINE_LABELS[line.line]} allowance is not configured. Set it under Product → Allowances before confirming.`,
      );
      continue;
    }

    const applied = applyAllowance(
      { widthCm: line.widthCm, heightCm: line.heightCm },
      allowance,
    );
    if (!applied) {
      reasons.push(
        `${locate(line)} has no measured width and height to work from.`,
      );
      continue;
    }

    // An override replaces the computed dimension, so it is the override that
    // has to be buildable — but only for the dimension it actually covers.
    const effectiveWidth = override?.overrideWidthCm ?? applied.mfgWidthCm;
    const effectiveHeight = override?.overrideHeightCm ?? applied.mfgHeightCm;

    if (effectiveWidth <= 0 || effectiveHeight <= 0) {
      reasons.push(
        !isManufacturable(applied) && !overridden
          ? `${locate(line)} works out to ${applied.mfgWidthCm} × ${applied.mfgHeightCm} cm after the allowance, which cannot be manufactured. Change the allowance or the measurement.`
          : `${locate(line)} would be manufactured at ${effectiveWidth} × ${effectiveHeight} cm, which is not a buildable size.`,
      );
    }
  }

  if (reasons.length === 0) return { ok: true };
  return { ok: false, reasons: [...new Set(reasons)] };
}
