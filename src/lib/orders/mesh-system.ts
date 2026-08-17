// Which track system a mesh panel needs.
//
// Decided by total window width and whether the panel is a single or double
// draw. A double draw splits the opening into two leaves, so each leaf carries
// half the span and a lighter system will do; past a certain width a single
// draw is not buildable at all.
//
// Pure and data-driven: the bands come from `mesh_system_bands`, which an admin
// edits in /admin/product/mesh. Nothing here knows about the database, so the same
// function serves the consultation form, the server actions and the tests.
//
// The system is a FABRICATION SPEC, not a price input. It is printed on the
// order for the factory; the quote stays area × the category's per-ft² rate.
//
// See docs/specs/phase-11-mesh-product-line.md §5.9.

import type { MeshDraw } from "@/lib/validation/mesh";

export type MeshSystemBand = {
  maxWidthCm: number;
  singleSystem: string | null; // null = not possible at this width
  doubleSystem: string | null;
};

export type MeshSystemPanel = {
  widthCm: number | null;
  draw: MeshDraw | undefined;
};

/**
 * The physical dimensions of one track system, in integer MILLIMETRES.
 *
 * The supplier's figures carry one decimal place in cm and so does the
 * resulting track length, so millimetres keep the whole chain exact integer
 * arithmetic with a single formatting step at the end — the same discipline as
 * money in cents.
 */
export type MeshSystemSpec = {
  name: string;
  rollerMm: number;
  handleMm: number;
  sideTrackMm: number;
};

export type MeshTrackResult =
  /**
   * The cut length for this panel's track, in millimetres, with the parts that
   * were subtracted. The breakdown is carried so the UI can show the working —
   * a bare number is impossible to sanity-check on site.
   */
  | {
      status: "resolved";
      trackMm: number;
      system: string;
      rollerMm: number;
      handleMm: number;
      /** Zero on a double draw: it carries no side track. */
      sideTrackMm: number;
      /** Roller-and-handle sets: 1 on a single draw, 2 on a double. */
      leaves: 1 | 2;
    }
  /** Not enough entered yet, or no system resolves. */
  | { status: "incomplete" }
  /** A system was chosen but nobody has entered its dimensions. */
  | { status: "unknown-system"; system: string }
  /** The hardware is wider than the window. */
  | { status: "too-narrow"; system: string; minimumMm: number };

export type MeshSystemResult =
  /** Resolved — this is the system to build. */
  | { status: "resolved"; system: string }
  /** Not enough entered yet to decide. Not an error. */
  | { status: "incomplete" }
  /** No system covers this width and draw. A blocking error. */
  | { status: "not-possible"; widthCm: number; isDouble: boolean };

/**
 * A double draw splits the opening into two leaves; every other draw carries
 * the full span on one. The matrix only distinguishes those two cases, so all
 * four `Single *` directions collapse together.
 */
export function isDoubleDraw(draw: MeshDraw | undefined): boolean {
  return draw === "Double";
}

/**
 * The narrowest band that fits, ordered by width. Ordered here rather than by
 * the bands' `position` column: which system gets built must not depend on a
 * display-ordering value staying in sync.
 *
 * There is deliberately no open-ended band. A width past the last band is
 * "wider than anything we build", which must stay an error rather than
 * silently resolving to the heaviest profile.
 */
export function resolveMeshSystem(
  panel: MeshSystemPanel,
  bands: MeshSystemBand[],
): MeshSystemResult {
  const { widthCm, draw } = panel;

  // A blank row, or one measured but not yet given a draw, is simply not ready.
  if (widthCm == null || widthCm <= 0 || draw == null) {
    return { status: "incomplete" };
  }

  const isDouble = isDoubleDraw(draw);
  const ordered = [...bands].sort((a, b) => a.maxWidthCm - b.maxWidthCm);
  const band = ordered.find((b) => widthCm <= b.maxWidthCm);

  const system = band
    ? isDouble
      ? band.doubleSystem
      : band.singleSystem
    : null;

  return system
    ? { status: "resolved", system }
    : { status: "not-possible", widthCm, isDouble };
}

/**
 * The track length once the hardware is subtracted from the window width.
 *
 *   single draw:  width − (roller + handle) − side track
 *   double draw:  width − 2 × (roller + handle)
 *
 * A double draw carries a roller and handle on each leaf and no side track;
 * a single carries one stack and a fixed side track down the far edge. The
 * mesh clears the glass either way — the hardware sits over the frame, not the
 * opening.
 *
 * Systems are matched to the matrix by name, case-insensitively and trimmed,
 * because the matrix stores the system as text an admin types. A name with no
 * spec returns `unknown-system` rather than a silently wrong length.
 */
export function resolveMeshTrack(
  panel: MeshSystemPanel,
  bands: MeshSystemBand[],
  specs: MeshSystemSpec[],
): MeshTrackResult {
  const resolved = resolveMeshSystem(panel, bands);
  if (resolved.status !== "resolved") return { status: "incomplete" };

  const key = resolved.system.trim().toLowerCase();
  const spec = specs.find((s) => s.name.trim().toLowerCase() === key);
  if (!spec) {
    return { status: "unknown-system", system: resolved.system };
  }

  const isDouble = isDoubleDraw(panel.draw);
  const leaves = isDouble ? 2 : 1;
  const sideTrackMm = isDouble ? 0 : spec.sideTrackMm;
  const hardwareMm = (spec.rollerMm + spec.handleMm) * leaves + sideTrackMm;

  // widthCm is non-null here: resolveMeshSystem only resolves when it is set.
  const trackMm = (panel.widthCm as number) * 10 - hardwareMm;

  if (trackMm <= 0) {
    return {
      status: "too-narrow",
      system: resolved.system,
      minimumMm: hardwareMm,
    };
  }

  return {
    status: "resolved",
    trackMm,
    system: resolved.system,
    rollerMm: spec.rollerMm,
    handleMm: spec.handleMm,
    sideTrackMm,
    leaves,
  };
}

/**
 * The panel laid out left to right, in millimetres, as it sits in the window.
 *
 *   single:  roller · handle · track · side track
 *   double:  roller · handle · track · handle · roller
 *
 * A double mirrors the hardware on the far leaf instead of a side track, which
 * is why the sequence is symmetric. The segments always sum to the window
 * width, and that is the point: it reads as a check, not as a formula.
 */
export type MeshTrackSegment = { mm: number; label: string };

export function meshTrackSegments(
  r: Extract<MeshTrackResult, { status: "resolved" }>,
): MeshTrackSegment[] {
  const roller = { mm: r.rollerMm, label: "roller" };
  const handle = { mm: r.handleMm, label: "handle" };
  const track = { mm: r.trackMm, label: "track" };

  return r.leaves === 2
    ? [roller, handle, track, handle, roller]
    : [roller, handle, track, { mm: r.sideTrackMm, label: "side track" }];
}

/** Millimetres as centimetres for display: 1852 → "185.2". */
export function formatMmAsCm(mm: number): string {
  const cm = mm / 10;
  return Number.isInteger(cm) ? String(cm) : cm.toFixed(1);
}

/** Human-readable reason, shared by the form and the server actions. */
export function meshSystemErrorMessage(
  r: Extract<MeshSystemResult, { status: "not-possible" }>,
): string {
  return r.isDouble
    ? `No system covers a ${r.widthCm} cm double draw — it is wider than anything buildable.`
    : `No system covers a ${r.widthCm} cm single draw. Split it into a double draw, or reduce the width.`;
}

export type MeshSystemProblem = {
  roomIndex: number;
  panelIndex: number;
  message: string;
};

/**
 * Every panel across the order that cannot be built. Unlike the mesh pricing
 * warnings this is a BLOCKING check — an unbuildable panel must not reach the
 * factory — so the server actions reject on a non-empty result and the form
 * refuses to submit.
 */
export function meshSystemProblems(
  rooms: { panels: MeshSystemPanel[] }[],
  bands: MeshSystemBand[],
): MeshSystemProblem[] {
  const problems: MeshSystemProblem[] = [];

  rooms.forEach((room, roomIndex) => {
    room.panels.forEach((panel, panelIndex) => {
      const r = resolveMeshSystem(panel, bands);
      if (r.status === "not-possible") {
        problems.push({
          roomIndex,
          panelIndex,
          message: meshSystemErrorMessage(r),
        });
      }
    });
  });

  return problems;
}
