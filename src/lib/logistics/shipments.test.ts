import { describe, expect, it } from "vitest";

import {
  hasExactShipmentCategories,
  requiresLocalDelivery,
  shipmentCategoriesForOrder,
  validateAllShipmentsArrived,
  validateShipmentNumbersForTransition,
  type ShipmentCategory,
  type ShipmentValues,
} from "./shipments";

function shipment(
  category: ShipmentCategory,
  values: Partial<ShipmentValues> = {},
): ShipmentValues {
  return {
    category,
    localDeliveryNumber: null,
    overseasFreightNumber: null,
    arrivedCheckedAt: null,
    arrivalNote: null,
    legacyLocalDeliveryNumber: null,
    legacyOverseasFreightNumber: null,
    source: "derived",
    updatedAt: new Date(0),
    ...values,
  };
}

describe("shipment routing", () => {
  it("requires local delivery only for vendor-made goods", () => {
    expect(requiresLocalDelivery("curtains")).toBe(true);
    expect(requiresLocalDelivery("blinds")).toBe(true);
    expect(requiresLocalDelivery("mesh")).toBe(true);
    expect(requiresLocalDelivery("standard_tracks")).toBe(false);
    expect(requiresLocalDelivery("s_fold_tracks")).toBe(false);
    expect(requiresLocalDelivery("overlap_tracks_attachment")).toBe(false);
  });
});

describe("shipmentCategoriesForOrder", () => {
  it("splits standard and S-fold tracks and adds overlap independently", () => {
    expect(shipmentCategoriesForOrder("curtain", [
      { hasCurtain: true, hasBlind: false, hasSFold: false, hasOverlap: false },
      { hasCurtain: true, hasBlind: false, hasSFold: true, hasOverlap: true },
      { hasCurtain: false, hasBlind: true, hasSFold: false, hasOverlap: false },
    ])).toEqual([
      "curtains",
      "blinds",
      "standard_tracks",
      "s_fold_tracks",
      "overlap_tracks_attachment",
    ]);
  });

  it("creates one mesh shipment only when a mesh panel exists", () => {
    expect(shipmentCategoriesForOrder("mesh", [], true)).toEqual(["mesh"]);
    expect(shipmentCategoriesForOrder("mesh", [], false)).toEqual([]);
  });

  it("does not let blind-only windows invent track shipments", () => {
    expect(shipmentCategoriesForOrder("curtain", [
      { hasCurtain: false, hasBlind: true, hasSFold: true, hasOverlap: true },
    ])).toEqual(["blinds"]);
  });
});

describe("hasExactShipmentCategories", () => {
  it("accepts the same unique categories in any order", () => {
    expect(hasExactShipmentCategories(
      ["curtains", "standard_tracks", "blinds"],
      ["blinds", "curtains", "standard_tracks"],
    )).toBe(true);
  });

  it("rejects missing, extra, or duplicate categories", () => {
    expect(hasExactShipmentCategories(
      ["curtains", "standard_tracks"], ["curtains"],
    )).toBe(false);
    expect(hasExactShipmentCategories(
      ["curtains"], ["curtains", "standard_tracks"],
    )).toBe(false);
    expect(hasExactShipmentCategories(
      ["curtains", "standard_tracks"], ["curtains", "curtains"],
    )).toBe(false);
  });
});

describe("validateShipmentNumbersForTransition", () => {
  const local = [
    shipment("curtains", { localDeliveryNumber: "L-C" }),
    shipment("standard_tracks"),
  ];

  it("does not require local delivery for direct track shipments", () => {
    expect(validateShipmentNumbersForTransition(
      ["curtains", "standard_tracks"], local, "local",
    )).toBeNull();
  });

  it("requires at least one overseas freight number before shipping starts", () => {
    expect(validateShipmentNumbersForTransition(
      ["curtains", "standard_tracks"], local, "overseas",
    )).toMatch(/overseas freight/);
  });

  it("allows the remaining shipments to receive freight numbers later", () => {
    expect(validateShipmentNumbersForTransition(
      ["curtains", "standard_tracks"],
      [
        shipment("curtains", {
          localDeliveryNumber: "L-C",
          overseasFreightNumber: "O-C",
        }),
        shipment("standard_tracks"),
      ],
      "overseas",
    )).toBeNull();
  });

  it("requires local delivery for mesh", () => {
    expect(validateShipmentNumbersForTransition(
      ["mesh"], [shipment("mesh")], "local",
    )).toMatch(/local delivery/);
  });

  it("blocks an empty manifest", () => {
    expect(validateShipmentNumbersForTransition([], [], "local"))
      .toMatch(/No shipment orders/);
  });

  it("requires a human to resolve imported combined references", () => {
    expect(validateShipmentNumbersForTransition(
      ["curtains"],
      [shipment("curtains", {
        localDeliveryNumber: "OLD-SHARED",
        source: "legacy_combined",
      })],
      "local",
    )).toMatch(/dedicated number/);
  });
});

describe("validateAllShipmentsArrived", () => {
  it("requires every shipment to have freight and an arrival check", () => {
    const rows = [
      shipment("curtains", {
        overseasFreightNumber: "O-C",
        arrivedCheckedAt: new Date(),
      }),
      shipment("s_fold_tracks", { overseasFreightNumber: "O-S" }),
    ];
    expect(validateAllShipmentsArrived(
      ["curtains", "s_fold_tracks"], rows,
    )).toMatch(/arrived and checked/);
    rows[1].arrivedCheckedAt = new Date();
    expect(validateAllShipmentsArrived(
      ["curtains", "s_fold_tracks"], rows,
    )).toBeNull();
  });
});
