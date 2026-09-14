import { describe, expect, it } from "vitest";
import { shipmentItemLabels, type ShipmentItemWindow } from "./shipment-items";

const window: ShipmentItemWindow = {
  day_curtain_type_id: null, night_curtain_type_id: null,
  blind_type_id: null, blind_series: null,
};
describe("shipment item labels", () => {
  it("lists day and night curtains once across multiple rooms", () => {
    const both = { ...window, day_curtain_type_id: "day", night_curtain_type_id: "night" };
    expect(shipmentItemLabels("curtains", [both, both])).toEqual(["Day curtains", "Night curtains"]);
  });
  it("does not invent a night curtain on a day-only order", () => {
    expect(shipmentItemLabels("curtains", [{ ...window, day_curtain_type_id: "day" }])).toEqual(["Day curtains"]);
  });
  it("lists each actual blind series without duplicates", () => {
    expect(shipmentItemLabels("blinds", [
      { ...window, blind_type_id: "1", blind_series: "Roller blinds" },
      { ...window, blind_type_id: "2", blind_series: "Roller blinds" },
      { ...window, blind_type_id: "3", blind_series: "Venetian blinds" },
    ])).toEqual(["Roller blinds", "Venetian blinds"]);
  });
  it("retains historical manifest items when product details are unavailable", () => {
    expect(shipmentItemLabels("curtains", [])).toEqual(["Curtains"]);
    expect(shipmentItemLabels("blinds", [])).toEqual(["Blinds"]);
  });
  it("preserves all track and mesh categories", () => {
    expect(shipmentItemLabels("standard_tracks", [])).toEqual(["Standard tracks"]);
    expect(shipmentItemLabels("s_fold_tracks", [])).toEqual(["S-fold tracks"]);
    expect(shipmentItemLabels("overlap_tracks_attachment", [])).toEqual(["Overlap track / attachment"]);
    expect(shipmentItemLabels("mesh", [])).toEqual(["Mesh"]);
  });
});
