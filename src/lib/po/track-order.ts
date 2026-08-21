// The rail order, as a block of text somebody pastes into WeChat.
//
// It is not the 采购订单. The PO tells a vendor what to SEW; this tells whoever
// supplies the rails what to CUT, and it goes as plain text because that is how
// it is sent — into a chat window, beside the PDF.
//
// The wording is the business's own, transcribed from a real order:
//
//   2.66米 双轨裁成1.33m 4根配连接器
//   2.56米 双轨裁成1.28m 4根配连接器
//   2.56米 双轨裁成1.28m 4根配连接器
//   多陪连接器和滑轨
//   加固包装
//
// Read: a 2.66 m opening takes a double rail, cut into 1.33 m halves, four
// pieces in all (two runs, each cut in two so it ships), with connectors. The
// half-width and the piece count both follow from the opening and the rail
// kind, which is the only reason this can be generated at all.
//
// NOTHING HERE READS THE DATABASE OR THE CLOCK.

import { cmToM } from "./build";

/** One window's rail. Blinds carry their own headrail and are not here. */
export type TrackOrderLine = {
  /** "Living Room — Window 1". For the screen; never in the copied text. */
  label: string;
  /** The MEASURED opening, in centimetres. */
  widthCm: number;
  /** Double when the window carries both a day and a night curtain. */
  kind: "single" | "double";
};

/**
 * The length each piece is cut to: half the opening, rounded UP to the
 * centimetre.
 *
 * Rounding up rather than down because a rail that arrives long is trimmed on
 * site and a rail that arrives short is a second delivery. The two halves of a
 * 2.67 m opening therefore come to 2.68 m between them, deliberately.
 */
export function cutLengthCm(widthCm: number): number {
  return Math.ceil(widthCm / 2);
}

/**
 * How many pieces: two per run, because each run is cut in half to ship, and a
 * double rail is two runs.
 *
 * NOTE: the single-rail count of 2 is derived from the double, not evidenced —
 * every sample line we have is a 双轨. If a single rail ships whole, this is
 * the line to change.
 */
export function pieceCount(kind: TrackOrderLine["kind"]): number {
  return kind === "double" ? 4 : 2;
}

/**
 * One line, in the business's own wording.
 *
 * The mixed 米/m units are theirs — the sample writes the opening in 米 and the
 * cut length in m — and are reproduced rather than tidied, for the same reason
 * catalogue labels are: the person reading this has been reading it that way
 * for years.
 */
export function trackOrderLine(line: TrackOrderLine): string {
  const kindCn = line.kind === "double" ? "双轨" : "单轨";
  return `${cmToM(line.widthCm)}米 ${kindCn}裁成${cmToM(
    cutLengthCm(line.widthCm),
  )}m ${pieceCount(line.kind)}根配连接器`;
}

/**
 * The whole block: one line per window, then the standing instructions.
 *
 * The note is stored, not written here — it is the business's sentence
 * ("多陪连接器和滑轨", "加固包装"), it changes without a deploy, and its typos
 * are theirs to keep.
 *
 * Returns "" when there is nothing to order, so the caller can decide whether
 * to show anything at all rather than offering an empty thing to copy.
 */
export function trackOrderText(
  lines: readonly TrackOrderLine[],
  noteCn: string | null,
): string {
  if (lines.length === 0) return "";
  const body = lines.map(trackOrderLine);
  const note = noteCn?.trim();
  return note ? [...body, note].join("\n") : body.join("\n");
}
