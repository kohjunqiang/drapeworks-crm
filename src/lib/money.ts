export function dollarsToCents(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.round(num * 100);
}

export function centsToDisplay(cents: number | null | undefined): string {
  const n = cents ?? 0;
  return (n / 100).toFixed(2);
}

const SGD = new Intl.NumberFormat("en-SG", {
  style: "currency",
  currency: "SGD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatSGD(cents: number | null | undefined): string {
  return SGD.format(Math.round((cents ?? 0) / 100));
}
