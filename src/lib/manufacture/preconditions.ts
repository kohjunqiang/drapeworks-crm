// Everything that has to be true before an order's manufacturing measurements
// can be frozen and the order handed to a vendor.
//
// Pure on purpose: the reconciliation screen runs this to decide whether the
// confirm button is live and what to explain, and the confirm action runs the
// same function inside its transaction. One implementation, so the screen can
// never promise something the action then refuses.

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
  const noun = line.kind === "window" ? "window" : "panel";
  return `${line.roomLabel} ${noun} ${line.position}`;
}

function hasReason(o: LineOverride | undefined): boolean {
  return (o?.overrideReason ?? "").trim().length > 0;
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

    if (overridden && !hasReason(override)) {
      reasons.push(`${locate(line)} is overridden without a reason.`);
    }

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
          ? `${locate(line)} works out to ${applied.mfgWidthCm} × ${applied.mfgHeightCm} cm after the allowance, which cannot be manufactured. Override it with a reason, or fix the measurement.`
          : `${locate(line)} would be manufactured at ${effectiveWidth} × ${effectiveHeight} cm, which is not a buildable size.`,
      );
    }
  }

  if (reasons.length === 0) return { ok: true };
  return { ok: false, reasons: [...new Set(reasons)] };
}
