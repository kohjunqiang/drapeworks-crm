import { describe, expect, it } from "vitest";

import { curtainPackageSchema } from "./product-pricing";

const PROPERTY_TIER_ID = "550e8400-e29b-41d4-a716-446655440000";
const PACKAGE_ID = "7c6a3f8c-49b1-4ad1-9756-fd321f47ce01";

const VALID_PACKAGE = {
  isNew: true,
  name: "4RM Essential Groupbuy",
  property_tier_id: PROPERTY_TIER_ID,
  package_type: "double",
  base_tier: "essential",
  price_sgd: "768.00",
} as const;

describe("curtainPackageSchema", () => {
  it("accepts Single and Double Essential packages", () => {
    expect(curtainPackageSchema.safeParse(VALID_PACKAGE).success).toBe(true);
    expect(
      curtainPackageSchema.safeParse({
        ...VALID_PACKAGE,
        package_type: "single",
      }).success,
    ).toBe(true);
  });
  it("keeps room upgrade and downgrade independently configurable, with zero distinct from blank", () => {
    const result = curtainPackageSchema.parse({...VALID_PACKAGE, room_tier2_upgrade_sgd:"0", room_tier2_downgrade_sgd:""});
    expect(result.room_tier2_upgrade_sgd).toBe("0");
    expect(result.room_tier2_downgrade_sgd).toBeUndefined();
    expect(curtainPackageSchema.safeParse({...VALID_PACKAGE,room_tier2_downgrade_sgd:"-50"}).success).toBe(false);
  });

  it("requires an id when editing", () => {
    const result = curtainPackageSchema.safeParse({ ...VALID_PACKAGE, isNew: false });

    expect(result.success).toBe(false);
  });

  it("accepts an edit with an id", () => {
    const result = curtainPackageSchema.safeParse({
      ...VALID_PACKAGE,
      isNew: false,
      id: PACKAGE_ID,
    });

    expect(result.success).toBe(true);
  });

  it("rejects negative prices and unsupported package types", () => {
    expect(
      curtainPackageSchema.safeParse({
        ...VALID_PACKAGE,
        package_type: "triple",
        price_sgd: "-1",
      }).success,
    ).toBe(false);
  });

  it("rejects a non-Essential starting tier", () => {
    expect(
      curtainPackageSchema.safeParse({
        ...VALID_PACKAGE,
        base_tier: "ultimate",
      }).success,
    ).toBe(false);
  });
});
