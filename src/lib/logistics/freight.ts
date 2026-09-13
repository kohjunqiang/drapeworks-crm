export function normalizeFreightNumber(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

const EMPTY_FREIGHT_VALUES = new Set([
  "",
  ".",
  "-",
  "n/a",
  "na",
  "nil",
  "none",
  "not yet",
]);

/**
 * A freight number, or null when the column holds a typed placeholder like
 * "N/a". The dashboard and the assignment action must agree on this, or the
 * server sees a reassignment the dialog never asked the user to confirm.
 */
export function usableFreightNumber(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return EMPTY_FREIGHT_VALUES.has(trimmed.toLowerCase()) ? null : trimmed;
}

export function formatFreightAge(
  assignedAt: Date | string | null,
  now: Date | string = new Date(),
): string | null {
  if (!assignedAt) return null;
  const elapsedMs = Math.max(
    0,
    new Date(now).getTime() - new Date(assignedAt).getTime(),
  );
  const hours = Math.floor(elapsedMs / 3_600_000);
  if (hours < 1) return "<1h";
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
