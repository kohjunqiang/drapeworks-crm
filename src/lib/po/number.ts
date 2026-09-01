const FIRST_MANUAL_PO_NUMBER = 10052;

/** Suggest the next numeric PO number without reserving it. */
export function nextPoNumber(references: Array<string | null>): string {
  let next = FIRST_MANUAL_PO_NUMBER;

  for (const reference of references) {
    const value = reference?.trim() ?? "";
    if (!/^\d+$/.test(value)) continue;
    const numeric = Number(value);
    if (!Number.isSafeInteger(numeric)) continue;
    const candidate = numeric + 1;
    if (candidate > next) next = candidate;
  }

  return String(next);
}
