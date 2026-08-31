import { describe, expect, it } from "vitest";
import { customerReference } from "./customer-reference";
import { poCustomerReferenceSchema } from "@/lib/validation/procurement";

const order = { customer_name: "Omar", development: "Tampines", unit_type: "08-146" };

describe("PO customer reference", () => {
  it("uses the entered name and address, preserving line breaks", () => {
    expect(customerReference({ ...order, po_customer_reference: "  Omar\n957B Tampines #08-146\nSingapore 522957  " }))
      .toBe("Omar\n957B Tampines #08-146\nSingapore 522957");
  });
  it.each([null, undefined, "", "  "])("falls back for %s", (reference) => {
    expect(customerReference({ ...order, po_customer_reference: reference }))
      .toBe("Omar Tampines 08-146");
  });
  it("handles missing automatic address parts", () => {
    expect(customerReference({ customer_name: "Omar", development: null, unit_type: null })).toBe("Omar");
  });
  it("normalizes blank edits to null and trims saved references", () => {
    expect(poCustomerReferenceSchema.parse("  ")).toBeNull();
    expect(poCustomerReferenceSchema.parse(" Omar\nAddress ")).toBe("Omar\nAddress");
  });
  it("rejects oversized and non-text inputs", () => {
    expect(poCustomerReferenceSchema.safeParse("a".repeat(501)).success).toBe(false);
    expect(poCustomerReferenceSchema.safeParse(123).success).toBe(false);
  });
});
