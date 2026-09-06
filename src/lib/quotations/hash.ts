import { createHash } from "node:crypto";

import { stableJson } from "./model";

export function quotePayloadHash(payload: unknown): string {
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}
