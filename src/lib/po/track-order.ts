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
//   多配连接器和滑轨
//   加固包装
//
// Read: a 2.66 m rail, run twice over the opening, each run cut into 1.33 m
// sections — four pieces in all — with connectors. The section length and the
// piece count both follow from the rail width and the rail kind, which is the
// only reason this can be generated at all.
//
// NOTHING HERE READS THE DATABASE OR THE CLOCK.

import { cmToM } from "./build";

/** One window's rail. Blinds carry their own headrail and are not here. */
export type TrackOrderLine = {
  /** "Living Room — Window 1". For the screen; never in the copied text. */
  label: string;
  /**
   * The RAIL width, in centimetres — the manufacturing width, which already
   * has the allowance taken off it (curtain is seeded at −2 cm and an admin can
   * change it). Nothing here deducts anything: do that twice and every rail in
   * the order arrives 2 cm short.
   */
  widthCm: number;
  /** Double when the window carries both a day and a night curtain. */
  kind: "single" | "double";
  /** S-fold rails are ordered and freighted separately from standard rails. */
  shipmentKind: "standard_tracks" | "s_fold_tracks";
  /** The track is fixed to the side wall rather than installed conventionally. */
  sideInstallation: boolean;
  /** Supply the overlap-track attachment for this opening. */
  overlapTracksAttachment: boolean;
};

/**
 * The longest a single piece may be, in centimetres.
 *
 * This is what forces the cutting at all — a rail longer than this is not a
 * rail the supplier will ship in one piece. 1.60 m exactly is allowed, which is
 * why a 3.20 m rail comes back as two pieces and not three.
 */
const MAX_PIECE_CM = 160;

/**
 * How many sections each run is cut into.
 *
 * The fewest that keeps every piece within MAX_PIECE_CM, so a rail short enough
 * to ship whole is left whole: 1.20 m is one piece, not two of 0.60 m.
 */
export function sectionCount(widthCm: number): number {
  return Math.max(1, Math.ceil(widthCm / MAX_PIECE_CM));
}

/**
 * The length each section is cut to, in MILLIMETRES.
 *
 * The sections are equal — the supplier cuts one length per line, not a run of
 * maximum-length pieces and a remainder — so this is simply the width divided
 * by the section count.
 *
 * Millimetres because the division rarely lands on a centimetre and the
 * printed figure is allowed a third decimal: 2.55 m in two is 1.275 m, and
 * writing that as 1.28 m hands the supplier 1 cm of rail per piece that the
 * opening has no room for. A millimetre IS the third decimal of a metre, so
 * carrying the integer count of them and formatting once at the end keeps the
 * arithmetic exact — the same reason build.ts carries hundredths.
 */
export function cutLengthMm(widthCm: number): number {
  return Math.round((widthCm * 10) / sectionCount(widthCm));
}

/**
 * How many pieces: one per section, and a double rail is two runs over the same
 * opening, so twice that.
 */
export function pieceCount(
  widthCm: number,
  kind: TrackOrderLine["kind"],
): number {
  const sections = sectionCount(widthCm);
  return kind === "double" ? sections * 2 : sections;
}

/**
 * 1330 → "1.33", 1275 → "1.275", 1500 → "1.50".
 *
 * Two decimals always, a third only when it is carrying something. Padding to
 * two keeps a round length from reading as a typo ("1.5m" beside "1.275m"
 * looks like a slip); printing a trailing zero on the third would be noise.
 */
function mmToM(mm: number): string {
  const whole = Math.floor(mm / 1000);
  const frac = String(mm % 1000).padStart(3, "0");
  const trimmed = frac.endsWith("0") ? frac.slice(0, 2) : frac;
  return `${whole}.${trimmed}`;
}

/**
 * One line, in the business's own wording.
 *
 * The mixed 米/m units are theirs — the sample writes the rail width in 米 and
 * the cut length in m — and are reproduced rather than tidied, for the same
 * reason catalogue labels are: the person reading this has been reading it that
 * way for years.
 */
export function trackOrderLine(line: TrackOrderLine): string {
  const kindCn = line.kind === "double" ? "双轨" : "单轨";
  const installation = line.sideInstallation ? " 侧装 Side installation" : "";
  const trackType = line.shipmentKind === "s_fold_tracks" ? " S-Fold" : "";
  return `${cmToM(line.widthCm)}米 ${kindCn}裁成${mmToM(
    cutLengthMm(line.widthCm),
  )}m ${pieceCount(line.widthCm, line.kind)}根配连接器${trackType}${installation}`;
}

export function overlapTrackOrderLine(line: TrackOrderLine): string {
  const kindCn = line.kind === "double" ? "双轨" : "单轨";
  return `${cmToM(line.widthCm)}米 ${kindCn} Overlap track / attachment`;
}

export function overlapTrackOrderText(
  lines: readonly TrackOrderLine[],
  noteCn: string | null,
): string {
  const overlapLines = lines.filter((line) => line.overlapTracksAttachment);
  if (overlapLines.length === 0) return "";
  const body = overlapLines.map(overlapTrackOrderLine);
  const note = noteCn?.trim();
  return note ? [...body, note].join("\n") : body.join("\n");
}

/**
 * The whole block: one line per window, then the standing instructions.
 *
 * The note is stored, not written here — it is the business's sentence
 * ("多配连接器和滑轨", "加固包装"), it changes without a deploy, and its
 * wording is theirs to keep.
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
