import "server-only";

// Zoho answers /invoices/fromestimates with a top-level success envelope even
// when it refuses to convert an estimate: the refusal is reported only as a
// numeric nonzero code nested in `data` ({code:1002, ids:[...], message:...}).
// That is a business rejection — the POST arrived and nothing was created —
// and must be distinguished from a lost response so the caller surfaces it
// instead of marking the attempt uncertain or risking a duplicate POST.
export class ZohoEstimateConversionRejectedError extends Error {
  readonly code: number;

  constructor(code: number) {
    super(`Zoho Books rejected the estimate-to-invoice conversion (code ${code})`);
    this.name = "ZohoEstimateConversionRejectedError";
    this.code = code;
  }
}
