import { describe, expect, it } from "vitest";

import { UserFacingError } from "@/lib/user-facing-error";
import {
  QUOTATION_FINAL_MESSAGE,
  assertEstimateEditable,
  assertQuotationStage,
  crmKeyConflicts,
  hasZohoDrift,
  quotationBreakdown,
} from "./lifecycle";

describe("assertQuotationStage", () => {
  it("allows order_recorded and quotation_sent", () => {
    expect(() => assertQuotationStage("order_recorded")).not.toThrow();
    expect(() => assertQuotationStage("quotation_sent")).not.toThrow();
  });
  it("reports a final quotation once the deposit is recorded", () => {
    for (const status of ["deposit_received", "po_ready", "completed"] as const) {
      expect(() => assertQuotationStage(status)).toThrow(UserFacingError);
      expect(() => assertQuotationStage(status)).toThrow(QUOTATION_FINAL_MESSAGE);
    }
  });
});

describe("assertEstimateEditable", () => {
  it.each(["draft", "sent", "accepted", "declined", "expired"])("allows a %s estimate", (status) => {
    expect(() => assertEstimateEditable({ status, invoice_ids: [] })).not.toThrow();
  });
  it("refuses an invoiced estimate", () => {
    expect(() => assertEstimateEditable({ status: "invoiced" })).toThrow("already been invoiced");
  });
  it("refuses any estimate that carries an invoice id", () => {
    expect(() => assertEstimateEditable({ status: "accepted", invoice_ids: ["inv-1"] })).toThrow(UserFacingError);
  });
});

describe("crmKeyConflicts", () => {
  it.each([undefined, null, ""])("is false when the remote key is %s", (remoteKey) => {
    expect(crmKeyConflicts(remoteKey, "dw:o-1:v1:q-1")).toBe(false);
  });
  it("is false when the remote key matches", () => {
    expect(crmKeyConflicts("dw:o-1:v1:q-1", "dw:o-1:v1:q-1")).toBe(false);
  });
  it("is true when the remote carries a different non-empty key", () => {
    expect(crmKeyConflicts("dw:other:v1:q-9", "dw:o-1:v1:q-1")).toBe(true);
  });
});

describe("hasZohoDrift", () => {
  const base = { storedModified: "t1", remoteModified: "t1", remoteHash: "r", storedHash: "s", payloadHash: "p" };
  it("is false when Zoho has not been modified since the last sync", () => {
    expect(hasZohoDrift(base)).toBe(false);
  });
  it("is false when only the status timestamp moved and the content still matches the last sync", () => {
    expect(hasZohoDrift({ ...base, remoteModified: "t2", remoteHash: "s" })).toBe(false);
  });
  it("is false when Zoho already equals the new payload", () => {
    expect(hasZohoDrift({ ...base, remoteModified: "t2", remoteHash: "p" })).toBe(false);
  });
  it("is true when Zoho content changed since the last sync", () => {
    expect(hasZohoDrift({ ...base, remoteModified: "t2" })).toBe(true);
  });
  it("is false when there is no stored timestamp (never synced)", () => {
    expect(hasZohoDrift({ ...base, storedModified: null, remoteModified: "t2" })).toBe(false);
  });
});

describe("quotationBreakdown", () => {
  it("renders one line per quotation line in dollars", () => {
    expect(quotationBreakdown([
      { zohoItemId: null, name: "Roller Blind(s)", description: "For LR", quantity: 1, rateCents: 48000, discountPercent: 0 },
      { zohoItemId: null, name: "Roller Blind(s)", description: "For BR", quantity: 2, rateCents: 15000, discountPercent: 0 },
    ])).toBe("Roller Blind(s): 1 × $480.00\nRoller Blind(s): 2 × $150.00");
  });
});
