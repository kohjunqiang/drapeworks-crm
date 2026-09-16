/** A selected curtain gets a new track unless its saved choice explicitly says no. */
export function newCurtainTrackCount(
  hasDay: boolean,
  hasNight: boolean,
  dayRequired = true,
  nightRequired = true,
): number {
  return Number(hasDay && dayRequired) + Number(hasNight && nightRequired);
}
