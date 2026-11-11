import { z } from "zod";

import type { Json } from "@/lib/db/schema";

/**
 * Installation-detail overrides stored on the booking
 * (fulfilment_arrangements.installation_details). They correct what the
 * installer reads — general instructions, per-room notes and per-opening
 * sizes/notes — without mutating the quoted windows, the measured site
 * dimensions, or the frozen PO measurements.
 *
 * Fallback rules for every override:
 *   - null / absent  → fall back to the original (PO size, then measured; the
 *                      window/panel note for instructions)
 *   - "" on a note   → explicitly cleared (an inherited note is suppressed)
 *   - a value        → replaces the original for installation display only
 */

const boundedText = z.string().max(2000);
const boundedNote = z.string().max(1000);
const dimensionCm = z.number().positive().finite().max(100_000);

export const installationOpeningOverrideSchema = z.object({
  width_cm: dimensionCm.nullable().optional(),
  height_cm: dimensionCm.nullable().optional(),
  note: boundedNote.nullable().optional(),
});

export const installationRoomOverrideSchema = z.object({
  note: boundedNote.nullable().optional(),
});

export const installationDetailsSchema = z.object({
  general_instructions: boundedText.nullable().optional(),
  rooms: z
    .record(z.string().uuid(), installationRoomOverrideSchema)
    .optional(),
  openings: z
    .record(z.string().uuid(), installationOpeningOverrideSchema)
    .optional(),
});

export type InstallationOpeningOverride = z.infer<
  typeof installationOpeningOverrideSchema
>;
export type InstallationRoomOverride = z.infer<
  typeof installationRoomOverrideSchema
>;
export type InstallationDetails = z.infer<typeof installationDetailsSchema>;

export const EMPTY_INSTALLATION_DETAILS: InstallationDetails = {
  general_instructions: null,
  rooms: {},
  openings: {},
};

/** Never throws — a malformed doc reads as "no overrides". */
export function parseInstallationDetails(raw: unknown): InstallationDetails {
  const parsed = installationDetailsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : EMPTY_INSTALLATION_DETAILS;
}

export function roomNote(
  details: InstallationDetails,
  roomId: string,
): string | null {
  return details.rooms?.[roomId]?.note ?? null;
}

export function openingOverride(
  details: InstallationDetails,
  openingId: string,
): InstallationOpeningOverride | undefined {
  return details.openings?.[openingId];
}

/**
 * Effective installation size for the summary cards.
 *
 * With no dimension override the card keeps its original behaviour: frozen PO
 * size or nothing. Once ops correct either axis, both axes resolve against
 * the same chain the copied summary uses — override → frozen → measured — so
 * a width-only correction still shows the measured height rather than "—".
 * `overridden` marks a real correction (value differs from what the original
 * data would have shown) so the UI can flag it.
 */
export function resolveInstallationSize(
  frozen: { widthCm: number | null; heightCm: number | null },
  measured: { widthCm: number | null; heightCm: number | null },
  override: InstallationOpeningOverride | undefined,
): { widthCm: number | null; heightCm: number | null; overridden: boolean } {
  const hasOverride =
    override?.width_cm != null || override?.height_cm != null;
  if (!hasOverride) {
    return {
      widthCm: frozen.widthCm,
      heightCm: frozen.heightCm,
      overridden: false,
    };
  }
  const baseWidth = frozen.widthCm ?? measured.widthCm;
  const baseHeight = frozen.heightCm ?? measured.heightCm;
  const widthCm = override?.width_cm ?? baseWidth;
  const heightCm = override?.height_cm ?? baseHeight;
  return {
    widthCm,
    heightCm,
    overridden:
      (override?.width_cm != null && override.width_cm !== baseWidth) ||
      (override?.height_cm != null && override.height_cm !== baseHeight),
  };
}

/**
 * Effective installation note. null/absent inherits the original; "" is an
 * explicit clear (returned as "" so the editor can show the cleared state and
 * renderers treat it as empty); anything else overrides.
 */
export function resolveInstallationNote(
  original: string | null,
  override: InstallationOpeningOverride | undefined,
): string | null {
  if (!override || override.note == null) return original;
  return override.note;
}

/** Serialize the document for the jsonb column. */
export function serializeInstallationDetails(details: InstallationDetails): Json {
  return JSON.stringify(details) as Json;
}
