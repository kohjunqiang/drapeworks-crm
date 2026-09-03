export const SHIPMENT_CATEGORIES = [
  "curtains",
  "blinds",
  "mesh",
  "standard_tracks",
  "s_fold_tracks",
  "overlap_tracks_attachment",
] as const;

export type ShipmentCategory = (typeof SHIPMENT_CATEGORIES)[number];

export type ShipmentValues = {
  category: ShipmentCategory;
  localDeliveryNumber: string | null;
  overseasFreightNumber: string | null;
  arrivedCheckedAt: string | Date | null;
  arrivalNote: string | null;
  legacyLocalDeliveryNumber: string | null;
  legacyOverseasFreightNumber: string | null;
  source: "derived" | "legacy_imported" | "legacy_combined";
  updatedAt: string | Date;
};

export type ShipmentTrackingMode = "local" | "overseas";

export const SHIPMENT_CATEGORY_LABELS: Record<ShipmentCategory, string> = {
  curtains: "Curtains",
  blinds: "Blinds",
  mesh: "Mesh",
  standard_tracks: "Standard tracks",
  s_fold_tracks: "S-fold tracks",
  overlap_tracks_attachment: "Overlap track / attachment",
};

const LOCAL_DELIVERY_CATEGORIES: readonly ShipmentCategory[] = [
  "curtains",
  "blinds",
  "mesh",
];

export function requiresLocalDelivery(category: ShipmentCategory): boolean {
  return LOCAL_DELIVERY_CATEGORIES.includes(category);
}

export function isDirectShipment(category: ShipmentCategory): boolean {
  return !requiresLocalDelivery(category);
}

export type ShipmentWindowFacts = {
  hasCurtain: boolean;
  hasBlind: boolean;
  hasSFold: boolean;
  hasOverlap: boolean;
};

export function shipmentCategoriesForOrder(
  productLine: "curtain" | "mesh",
  windows: ReadonlyArray<ShipmentWindowFacts>,
  hasMeshPanel = false,
): ShipmentCategory[] {
  if (productLine === "mesh") return hasMeshPanel ? ["mesh"] : [];
  return SHIPMENT_CATEGORIES.filter((category) =>
    (category === "curtains" && windows.some((window) => window.hasCurtain)) ||
    (category === "blinds" && windows.some((window) => window.hasBlind)) ||
    (category === "standard_tracks" && windows.some((window) =>
      window.hasCurtain && !window.hasSFold)) ||
    (category === "s_fold_tracks" && windows.some((window) =>
      window.hasCurtain && window.hasSFold)) ||
    (category === "overlap_tracks_attachment" && windows.some((window) =>
      window.hasCurtain && window.hasOverlap)));
}

export function hasExactShipmentCategories(
  expected: ReadonlyArray<ShipmentCategory>,
  received: ReadonlyArray<ShipmentCategory>,
): boolean {
  return expected.length === received.length &&
    expected.every((category) => received.includes(category)) &&
    new Set(received).size === received.length;
}

export function validateShipmentNumbersForTransition(
  expected: ReadonlyArray<ShipmentCategory>,
  received: ReadonlyArray<ShipmentValues>,
  mode: ShipmentTrackingMode,
): string | null {
  if (expected.length === 0) {
    return "No shipment orders found. Review the vendor orders before advancing.";
  }
  if (!hasExactShipmentCategories(
    expected,
    received.map((shipment) => shipment.category),
  )) {
    return "Shipment orders changed. Refresh and try again.";
  }
  if (
    received.some((shipment) =>
      requiresLocalDelivery(shipment.category) &&
      !shipment.localDeliveryNumber?.trim())
  ) {
    return "Enter a local delivery number for Curtains, Blinds and Mesh shipments.";
  }
  if (
    mode === "overseas" &&
    received.some((shipment) => !shipment.overseasFreightNumber?.trim())
  ) {
    return "Enter an overseas freight number for every shipment.";
  }
  if (received.some((shipment) => shipment.source === "legacy_combined")) {
    return "Confirm a dedicated number for each imported combined shipment.";
  }
  return null;
}

export function validateAllShipmentsArrived(
  expected: ReadonlyArray<ShipmentCategory>,
  received: ReadonlyArray<ShipmentValues>,
): string | null {
  if (expected.length === 0) {
    return "No shipment orders found. Review the vendor orders before advancing.";
  }
  if (!hasExactShipmentCategories(
    expected,
    received.map((shipment) => shipment.category),
  )) {
    return "Shipment orders changed. Refresh and try again.";
  }
  if (received.some((shipment) => !shipment.overseasFreightNumber?.trim())) {
    return "Enter an overseas freight number for every shipment.";
  }
  if (received.some((shipment) => !shipment.arrivedCheckedAt)) {
    return "Mark every shipment as arrived and checked before advancing.";
  }
  return null;
}
