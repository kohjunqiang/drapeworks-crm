export function normalizeFreightNumber(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
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
