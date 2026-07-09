// Pure helpers for curtain-type series/index/page. No "server-only" so they can
// be unit-tested and shared by server actions + client components.

// Next running index within a series: max + 1 (never backfills gaps, so archived
// or deleted rows don't cause a number to be reused). 1 for an empty series.
export function nextSeriesIndex(existing: number[]): number {
  return existing.length === 0 ? 1 : Math.max(...existing) + 1;
}

// Identifier label for a curtain type: "Series #index · Page — Label", omitting
// any missing part. Used by the consultation-form dropdown and order detail.
export function formatCurtainOptionLabel({
  series,
  index,
  page,
  label,
}: {
  series: string | null;
  index: number | null;
  page: string | null;
  label: string;
}): string {
  const bits: string[] = [];
  if (series && index != null) bits.push(`${series} #${index}`);
  else if (series) bits.push(series);
  else if (index != null) bits.push(`#${index}`);
  if (page) bits.push(page);

  const prefix = bits.join(" · ");
  return prefix ? `${prefix} — ${label}` : label;
}
