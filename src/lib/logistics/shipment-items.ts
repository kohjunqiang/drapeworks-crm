import { SHIPMENT_CATEGORY_LABELS, type ShipmentCategory } from "./shipments";

export type ShipmentItemWindow = {
  day_curtain_type_id: string | null;
  night_curtain_type_id: string | null;
  blind_type_id: string | null;
  blind_series: string | null;
};

/** Item labels refine the manifest; tracking still belongs to its category. */
export function shipmentItemLabels(category: ShipmentCategory, windows: readonly ShipmentItemWindow[]): string[] {
  if (category === "curtains") {
    const labels = [];
    if (windows.some((window) => window.day_curtain_type_id)) labels.push("Day curtains");
    if (windows.some((window) => window.night_curtain_type_id)) labels.push("Night curtains");
    return labels.length ? labels : [SHIPMENT_CATEGORY_LABELS[category]];
  }
  if (category === "blinds") {
    const labels = [...new Set(windows.filter((window) => window.blind_type_id)
      .map((window) => window.blind_series?.trim() || "Blinds"))];
    return labels.length ? labels : [SHIPMENT_CATEGORY_LABELS[category]];
  }
  return [SHIPMENT_CATEGORY_LABELS[category]];
}
