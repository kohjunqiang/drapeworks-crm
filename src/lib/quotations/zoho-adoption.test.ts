import { describe, expect, it } from "vitest";

import { estimateSnapshotHash, zohoAdoptionFingerprint } from "./hash";
import { adoptedTotalMatches, isValidZohoDate, zohoAdoptionIssues, zohoLineDiscountPercent, zohoLineForDisplay, zohoLinesFromEstimate, zohoValidatedLines } from "./zoho-adoption";
import type { ZohoEstimate } from "@/lib/zoho/books";

function remote(patch: Partial<ZohoEstimate> = {}): ZohoEstimate {
  return {
    estimate_id: "est-1",
    estimate_number: "QT-1",
    status: "draft",
    total: 810,
    currency_code: "SGD",
    customer_id: "contact-1",
    date: "2026-11-01",
    line_items: [
      { name: "Sheer", quantity: 2, rate: 450, discount: "10%" },
    ],
    ...patch,
  };
}

describe("zohoLineDiscountPercent", () => {
  it.each([
    ["10%", 10],
    ["12.5%", 12.5],
    ["0%", 0],
    [0, 0],
    ["0", 0],
    [undefined, 0],
    [null, 0],
  ])("reads %j as %s", (input, expected) => {
    expect(zohoLineDiscountPercent(input)).toBe(expected);
  });

  it.each([5, 250, "250", "abc", "110%", "-5%"])("rejects %j as ambiguous or out of range", (input) => {
    expect(zohoLineDiscountPercent(input)).toBeNull();
  });
});

describe("zohoAdoptionIssues", () => {
  it("accepts a plain item-level estimate", () => {
    expect(zohoAdoptionIssues(remote())).toEqual([]);
  });

  it("flags an invoiced estimate", () => {
    expect(zohoAdoptionIssues(remote({ status: "invoiced" }))).toEqual(
      expect.arrayContaining([expect.stringContaining("invoiced")]),
    );
    expect(zohoAdoptionIssues(remote({ invoice_ids: ["inv-1"] }))).toEqual(
      expect.arrayContaining([expect.stringContaining("invoiced")]),
    );
  });

  it.each([0, "0", "0%", "0.00%", undefined])("accepts a zero document discount %j", (discount) => {
    expect(zohoAdoptionIssues(remote({ discount: discount as ZohoEstimate["discount"] }))).toEqual([]);
  });

  it.each([5, "5%", "abc", "10.5.2%"])("flags a document discount %j", (discount) => {
    expect(zohoAdoptionIssues(remote({ discount: discount as ZohoEstimate["discount"] }))).toEqual(
      expect.arrayContaining([expect.stringContaining("document-level discount")]),
    );
  });

  it.each([
    ["tax total", { tax_total: 56.7 }],
    ["line tax percentage", { line_items: [{ name: "Sheer", quantity: 2, rate: 450, discount: "10%", tax_percentage: 9 }] }],
    ["line tax id", { line_items: [{ name: "Sheer", quantity: 2, rate: 450, discount: "10%", tax_id: "tax-1" }] }],
    ["an adjustment", { adjustment: -5 }],
    ["a shipping charge", { shipping_charge: 20 }],
    ["a fixed-amount line discount", { line_items: [{ name: "Sheer", quantity: 2, rate: 450, discount_amount: 50 }] }],
    ["a bare numeric line discount", { line_items: [{ name: "Sheer", quantity: 2, rate: 450, discount: 50 }] }],
  ])("flags %s", (_label, patch) => {
    expect(zohoAdoptionIssues(remote(patch as Partial<ZohoEstimate>)).length).toBeGreaterThan(0);
  });

  it("flags an estimate with no lines", () => {
    expect(zohoAdoptionIssues(remote({ line_items: [] }))).toEqual(
      expect.arrayContaining([expect.stringContaining("no line items")]),
    );
  });

  it("tolerates ordinary float error in an exactly-priced rate", () => {
    expect(zohoAdoptionIssues(remote({ line_items: [{ name: "Sheer", quantity: 1, rate: 1.1 }], total: 1.1 }))).toEqual([]);
  });

  it("accepts an explicit percentage alongside consistent derived amounts", () => {
    const estimate = remote({
      total: 180,
      line_items: [{ name: "Sheer", quantity: 2, rate: 100, discount: "10%", discount_amount: 20, item_total: 180 }],
    });
    expect(zohoAdoptionIssues(estimate)).toEqual([]);
    expect(zohoLinesFromEstimate(estimate)).toEqual([
      { zohoItemId: null, name: "Sheer", description: "", quantity: 2, rateCents: 10_000, discountPercent: 10 },
    ]);
    expect(zohoLineForDisplay(estimate.line_items![0]).discountText).toBe("10%");
    expect(adoptedTotalMatches(zohoLinesFromEstimate(estimate), estimate)).toBe(true);
  });

  it.each([
    ["a discount_amount contradicting the percentage", { line_items: [{ name: "Sheer", quantity: 2, rate: 100, discount: "10%", discount_amount: 25 }] }],
    ["an item_total contradicting the percentage", { line_items: [{ name: "Sheer", quantity: 2, rate: 100, discount: "10%", item_total: 175 }] }],
    ["an amount-only discount with no percentage", { line_items: [{ name: "Sheer", quantity: 2, rate: 100, discount_amount: 20 }] }],
    ["a whole-cent discount_amount disagreement", { line_items: [{ name: "Sheer", quantity: 2, rate: 100, discount: "10%", discount_amount: 20.01 }] }],
    ["a non-finite discount_amount echo", { line_items: [{ name: "Sheer", quantity: 2, rate: 100, discount: "10%", discount_amount: NaN }] }],
    ["a non-finite item_total echo", { line_items: [{ name: "Sheer", quantity: 2, rate: 100, discount: "10%", item_total: NaN }] }],
    ["a sub-cent rate the CRM cannot store", { line_items: [{ name: "Sheer", quantity: 1, rate: 10.005 }] }],
    ["a non-finite rate", { line_items: [{ name: "Sheer", quantity: 1, rate: NaN }] }],
    ["a non-finite quantity", { line_items: [{ name: "Sheer", quantity: NaN, rate: 100 }] }],
    ["an impossible calendar date", { date: "2026-02-30" }],
    ["an impossible expiry date", { expiry_date: "2026-02-30" }],
    ["a missing issue date", { date: undefined }],
    ["more than 100 lines", { line_items: Array.from({ length: 101 }, () => ({ name: "x", quantity: 1, rate: 10 })) }],
    ["oversized notes", { notes: "x".repeat(5001) }],
    ["oversized terms", { terms: "x".repeat(5001) }],
  ])("flags %s", (_label, patch) => {
    expect(zohoAdoptionIssues(remote(patch as Partial<ZohoEstimate>)).length).toBeGreaterThan(0);
  });
});

describe("zohoLinesFromEstimate", () => {
  it("converts percentage discounts and keeps zero", () => {
    const lines = zohoLinesFromEstimate(remote({
      line_items: [
        { item_id: "item-9", name: "Sheer", description: "day", quantity: 2, rate: 450, discount: "10%" },
        { name: "Track", quantity: 1, rate: 100, discount: 0 },
      ],
    }));
    expect(lines).toEqual([
      { zohoItemId: "item-9", name: "Sheer", description: "day", quantity: 2, rateCents: 45000, discountPercent: 10 },
      { zohoItemId: null, name: "Track", description: "", quantity: 1, rateCents: 10000, discountPercent: 0 },
    ]);
  });

  it("throws instead of reinterpreting a numeric amount discount", () => {
    expect(() => zohoLinesFromEstimate(remote({
      line_items: [{ name: "Sheer", quantity: 2, rate: 450, discount: 50 }],
    }))).toThrow("not an explicit percentage");
  });
});

describe("isValidZohoDate", () => {
  it.each(["2026-11-01", "2024-02-29"])("accepts %s", (value) => {
    expect(isValidZohoDate(value)).toBe(true);
  });
  it.each(["2026-02-30", "2025-02-29", "2026-13-01", "11/01/2026", "2026-11-1", "", undefined, null])("rejects %j", (value) => {
    expect(isValidZohoDate(value)).toBe(false);
  });
});

describe("zohoValidatedLines", () => {
  it("returns the converted lines when they fit the CRM schema", () => {
    expect(zohoValidatedLines(remote())).toHaveLength(1);
  });

  it("returns empty for shapes the CRM schema rejects", () => {
    expect(zohoValidatedLines(remote({ line_items: [{ name: "Sheer", quantity: -2, rate: 450 }] }))).toEqual([]);
    expect(zohoValidatedLines(remote({ line_items: [{ name: "Sheer", quantity: 2, rate: "abc" as unknown as number }] }))).toEqual([]);
    expect(zohoValidatedLines(remote({ line_items: [{ name: "x".repeat(201), quantity: 1, rate: 10 }] }))).toEqual([]);
    expect(zohoValidatedLines(remote({ line_items: [] }))).toEqual([]);
  });
});

describe("adoptedTotalMatches", () => {
  it("accepts a reconstructed total equal to the Zoho total", () => {
    const estimate = remote();
    expect(adoptedTotalMatches(zohoLinesFromEstimate(estimate), estimate)).toBe(true);
  });

  it("rejects a reconstructed total that differs from the Zoho total", () => {
    expect(adoptedTotalMatches(zohoLinesFromEstimate(remote()), remote({ total: 999 }))).toBe(false);
  });
});

describe("zohoAdoptionFingerprint", () => {
  it("changes when identity, status, total or content change", () => {
    const base = remote() as unknown as Record<string, unknown>;
    const fingerprint = zohoAdoptionFingerprint(base);
    expect(zohoAdoptionFingerprint(remote() as unknown as Record<string, unknown>)).toBe(fingerprint);
    expect(zohoAdoptionFingerprint(remote({ status: "sent" }) as unknown as Record<string, unknown>)).not.toBe(fingerprint);
    expect(zohoAdoptionFingerprint(remote({ total: 900 }) as unknown as Record<string, unknown>)).not.toBe(fingerprint);
    expect(zohoAdoptionFingerprint(remote({ estimate_id: "est-2" }) as unknown as Record<string, unknown>)).not.toBe(fingerprint);
    expect(zohoAdoptionFingerprint(remote({ invoice_ids: ["inv-1"] }) as unknown as Record<string, unknown>)).not.toBe(fingerprint);
    expect(zohoAdoptionFingerprint(remote({ last_modified_time: "later" }) as unknown as Record<string, unknown>)).not.toBe(fingerprint);
    expect(zohoAdoptionFingerprint(remote({ notes: "edited" }) as unknown as Record<string, unknown>)).not.toBe(fingerprint);
    expect(zohoAdoptionFingerprint(base)).not.toBe(estimateSnapshotHash(base));
  });

  it("covers guard and display fields even when timestamp and total are unchanged", () => {
    const fingerprint = zohoAdoptionFingerprint(remote() as unknown as Record<string, unknown>);
    const variants = [
      remote({ custom_fields: [{ label: "CRM Quote Key", value: "dw:other" }] }),
      remote({ customer_id: "contact-2" }),
      remote({ reference_number: "ref-9" }),
      remote({ template_id: "tmpl-2" }),
      remote({ terms: "new terms" }),
      remote({ expiry_date: "2026-11-30" }),
      remote({ sub_total: 900 }),
      remote({ discount: 10 }),
      remote({ discount_type: "entity_level" }),
      remote({ is_inclusive_tax: true }),
      remote({ tax_total: 9 }),
      remote({ taxes: [{ tax_name: "GST", tax_amount: 1 }] }),
      remote({ adjustment: -5 }),
      remote({ shipping_charge: 5 }),
      remote({ line_items: [{ name: "Renamed", quantity: 2, rate: 450, discount: "10%" }] }),
      remote({ line_items: [{ name: "Sheer", description: "new fabric", quantity: 2, rate: 450, discount: "10%" }] }),
      remote({ line_items: [{ name: "Sheer", quantity: 2, rate: 450, discount: "10%", discount_amount: 90 }] }),
      remote({ line_items: [{ name: "Sheer", quantity: 2, rate: 450, discount: "10%", item_total: 900 }] }),
      remote({ line_items: [{ name: "Sheer", quantity: 2, rate: 450, discount: "10%", tax_id: "tax-1" }] }),
      remote({ line_items: [{ name: "Sheer", quantity: 2, rate: 450, discount: "10%", tax_percentage: 9 }] }),
    ];
    for (const variant of variants) {
      expect(zohoAdoptionFingerprint(variant as unknown as Record<string, unknown>)).not.toBe(fingerprint);
    }
  });
});

describe("zohoLineForDisplay", () => {
  it("shows percentage, amount and ambiguous discounts verbatim", () => {
    expect(zohoLineForDisplay({ name: "A", quantity: 1, rate: 10, discount: "10%" }).discountText).toBe("10%");
    expect(zohoLineForDisplay({ name: "A", quantity: 1, rate: 10, discount_amount: 5 }).discountText).toBe("S$5.00");
    expect(zohoLineForDisplay({ name: "A", quantity: 1, rate: 10, discount: 50 }).discountText).toBe("50");
    expect(zohoLineForDisplay({ name: "A", quantity: 1, rate: 10 }).discountText).toBe("0%");
  });
});
