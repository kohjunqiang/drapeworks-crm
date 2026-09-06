/** Round half of a quoted amount to the nearest payable cent. */
export function halfDepositCents(quotedCents: number): number {
  return Math.round(quotedCents / 2);
}
