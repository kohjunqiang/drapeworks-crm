/**
 * A calendar date in Asia/Singapore, as `YYYY-MM-DD`.
 *
 * The whole queue engine compares dates against "today". Keeping them as ISO
 * strings means `a < b` is already correct date ordering, and there is no Date
 * object left for a UTC boundary to corrupt. Singapore has no DST and a fixed
 * +08:00 offset, so this is exact rather than approximate.
 */
export type SgDate = string;

const SG_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Singapore",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The Singapore calendar date on which `instant` falls. */
export function toSgDate(instant: Date): SgDate {
  // en-CA formats as YYYY-MM-DD, which is exactly the shape we want.
  return SG_FORMATTER.format(instant);
}

/** Today's date in Singapore. The engine's `TODAY()`. */
export function todayInSingapore(): SgDate {
  return toSgDate(new Date());
}

/** `date` shifted by `days`, which may be negative. */
export function addDays(date: SgDate, days: number): SgDate {
  // Anchored at noon UTC so that adding days can never trip over a DST or
  // offset edge in either direction before we re-read the calendar fields.
  const [y, m, d] = date.split("-").map(Number);
  const anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  anchor.setUTCDate(anchor.getUTCDate() + days);
  return anchor.toISOString().slice(0, 10);
}
