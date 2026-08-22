/**
 * A calendar date in Asia/Singapore, as `YYYY-MM-DD`.
 *
 * The whole queue engine compares dates against "today". Keeping them as ISO
 * strings means `a < b` is already correct date ordering, and there is no Date
 * object left for a UTC boundary to corrupt. Singapore has no DST and a fixed
 * +08:00 offset, so this is exact rather than approximate.
 */
export type SgDate = string;

/**
 * Singapore has been a fixed +08:00 with no DST since 1982, so one constant is
 * exact rather than an approximation. The same constant appears in the import
 * scripts, which read wall-clock times out of the spreadsheet.
 */
const SG_OFFSET_MS = 8 * 60 * 60 * 1000;

/** The Singapore calendar date on which `instant` falls. */
export function toSgDate(instant: Date): SgDate {
  // Deliberately arithmetic rather than Intl.DateTimeFormat with a timeZone.
  // That would need full ICU tz data at runtime; a small-ICU build silently
  // falls back to UTC and reintroduces exactly the eight-hour error this whole
  // module exists to prevent — wrong, and wrong without failing.
  //
  // Shifting the instant by the offset and then reading UTC fields IS the
  // Singapore calendar date. This is not the naive
  // `instant.toISOString().slice(0, 10)`, which reads a wall-clock instant in
  // the wrong zone; the shift is what makes it correct.
  return new Date(instant.getTime() + SG_OFFSET_MS).toISOString().slice(0, 10);
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
