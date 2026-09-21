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
  it("keeps curtains but omits tracks and attachments when no new track is required", () => {
    expect(shipmentCategoriesForOrder("curtain", [
      { hasCurtain: true, hasBlind: false, hasSFold: true, hasOverlap: true, needsTrack: false },
    ])).toEqual(["curtains"]);
  });
  it("preserves another window's required tracks in a mixed order", () => {
    expect(shipmentCategoriesForOrder("curtain", [
      { hasCurtain: true, hasBlind: false, hasSFold: true, hasOverlap: true, needsTrack: false },
      { hasCurtain: true, hasBlind: false, hasSFold: false, hasOverlap: false, needsTrack: true },
    ])).toEqual(["curtains", "standard_tracks"]);
  });
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

  it("requires every shipment to carry an overseas freight number before shipping starts", () => {
    expect(validateShipmentNumbersForTransition(
      ["curtains", "standard_tracks"], local, "overseas",
    )).toMatch(/overseas freight/);
  });

  it("rejects when a required shipment still lacks a freight number", () => {
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
    )).toMatch(/every shipment/);
  });

  it("passes once every required shipment has a freight number", () => {
    expect(validateShipmentNumbersForTransition(
      ["curtains", "standard_tracks"],
      [
        shipment("curtains", {
          localDeliveryNumber: "L-C",
          overseasFreightNumber: "O-C",
        }),
        shipment("standard_tracks", { overseasFreightNumber: "O-T" }),
      ],
      "overseas",
    )).toBeNull();
  });

  it("excludes a not-needed shipment without a freight number", () => {
    expect(validateShipmentNumbersForTransition(
      ["curtains", "standard_tracks"],
      [
        shipment("curtains", {
          localDeliveryNumber: "L-C",
          overseasFreightNumber: "O-C",
        }),
        shipment("standard_tracks", { notNeeded: true }),
      ],
      "overseas",
    )).toBeNull();
  });

  it.each(["N/A", "-", "none"])(
    "treats placeholder freight %j as missing",
    (freight) => {
      expect(validateShipmentNumbersForTransition(
        ["curtains"],
        [shipment("curtains", {
          localDeliveryNumber: "L-C",
          overseasFreightNumber: freight,
        })],
        "overseas",
      )).toMatch(/every shipment/);
    },
  );

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

  it.each(["N/A", "-", "none"])("rejects placeholder freight %j", (freight) => {
    const rows = [
      shipment("curtains", {
        overseasFreightNumber: freight,
        arrivedCheckedAt: new Date(),
      }),
    ];
    expect(validateAllShipmentsArrived(["curtains"], rows))
      .toMatch(/overseas freight/);
  });
});

describe("shipments marked not needed", () => {
  const skipped: ShipmentValues = {
    category: "standard_tracks", notNeeded: true,
    localDeliveryNumber: null, overseasFreightNumber: null,
    arrivedCheckedAt: null, arrivalNote: null,
    legacyLocalDeliveryNumber: null, legacyOverseasFreightNumber: null,
    source: "derived", updatedAt: new Date(),
  };
  it("does not require tracking or arrival for an excluded shipment", () => {
    expect(validateShipmentNumbersForTransition(["standard_tracks"], [skipped], "overseas")).toBeNull();
    expect(validateAllShipmentsArrived(["standard_tracks"], [skipped])).toBeNull();
  });
  it("requires tracking again after restoring a shipment", () => {
    const restored = { ...skipped, notNeeded: false };
    expect(validateAllShipmentsArrived(["standard_tracks"], [restored])).not.toBeNull();
  });
  it("does not excuse another required shipment", () => {
    const required = { ...skipped, category: "s_fold_tracks" as const, notNeeded: false };
    expect(validateAllShipmentsArrived(["standard_tracks", "s_fold_tracks"], [skipped, required])).not.toBeNull();
  });
});
