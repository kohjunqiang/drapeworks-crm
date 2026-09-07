import { createHash } from "node:crypto";

import { stableJson } from "./model";

export function quotePayloadHash(payload: unknown): string {
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}

export function matchesStoredZohoEstimate(input: {
  remoteKey: unknown;
  expectedKey: string;
  remoteCustomerId: string | undefined;
  expectedCustomerId: string;
  remoteCurrency: string | undefined;
  remoteTotalCents: number;
  expectedTotalCents: number;
  remoteStatus: string;
  remoteSnapshotHash: string;
  storedSnapshotHash: string | null;
}): boolean {
  const keyMatches = !input.remoteKey || input.remoteKey === input.expectedKey;
  return keyMatches &&
    Boolean(input.storedSnapshotHash) &&
    ["sent", "accepted", "invoiced"].includes(input.remoteStatus) &&
    input.remoteCustomerId === input.expectedCustomerId &&
    input.remoteCurrency === "SGD" &&
    input.remoteTotalCents === input.expectedTotalCents &&
    input.remoteSnapshotHash === input.storedSnapshotHash;
}
