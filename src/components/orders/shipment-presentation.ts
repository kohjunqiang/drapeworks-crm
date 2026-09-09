import type { ShipmentCategory } from "@/lib/logistics/shipments";

const SHIPMENT_CATEGORY_TONES: Record<
  ShipmentCategory,
  { dot: string; label: string; pill: string }
> = {
  curtains: {
    dot: "bg-rose-500",
    label: "text-rose-700",
    pill: "border-rose-200 bg-rose-50",
  },
  blinds: {
    dot: "bg-amber-500",
    label: "text-amber-700",
    pill: "border-amber-200 bg-amber-50",
  },
  mesh: {
    dot: "bg-emerald-500",
    label: "text-emerald-700",
    pill: "border-emerald-200 bg-emerald-50",
  },
  standard_tracks: {
    dot: "bg-blue-500",
    label: "text-blue-700",
    pill: "border-blue-200 bg-blue-50",
  },
  s_fold_tracks: {
    dot: "bg-violet-500",
    label: "text-violet-700",
    pill: "border-violet-200 bg-violet-50",
  },
  overlap_tracks_attachment: {
    dot: "bg-cyan-500",
    label: "text-cyan-700",
    pill: "border-cyan-200 bg-cyan-50",
  },
};

export function shipmentCategoryTone(category: ShipmentCategory) {
  return SHIPMENT_CATEGORY_TONES[category];
}
