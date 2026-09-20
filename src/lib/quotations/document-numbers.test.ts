import { describe, expect, it } from "vitest";

import { documentNumberSuffix, invoiceNumberFor } from "./document-numbers";

describe("document numbers derived from the Zoho estimate number", () => {
  it("strips one alphabetic prefix and its hyphen", () => {
    expect(documentNumberSuffix("QT-677816")).toBe("677816");
    expect(invoiceNumberFor("QT-677816")).toBe("INV-677816");
  });

  it("uses a number without a prefix whole", () => {
    expect(documentNumberSuffix("677816")).toBe("677816");
    expect(invoiceNumberFor("677816")).toBe("INV-677816");
  });

  it("strips only the first alphabetic prefix", () => {
    expect(invoiceNumberFor("QT-677816-A")).toBe("INV-677816-A");
  });

  it("trims surrounding whitespace", () => {
    expect(documentNumberSuffix("  QT-677816  ")).toBe("677816");
  });

  it("returns null for an empty or missing estimate number", () => {
    expect(documentNumberSuffix(null)).toBeNull();
    expect(documentNumberSuffix(undefined)).toBeNull();
    expect(documentNumberSuffix("   ")).toBeNull();
    expect(documentNumberSuffix("QT-")).toBeNull();
    expect(invoiceNumberFor(null)).toBeNull();
    expect(invoiceNumberFor("")).toBeNull();
  });
});
