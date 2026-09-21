import { describe, expect, it } from "vitest";

import { buildFabricSelectionNotes, quotationRoomCode, type FabricNoteWindow } from "./fabric-notes";

function window(overrides: Partial<FabricNoteWindow> & { roomId: string }): FabricNoteWindow {
  return {
    dayLabel: null,
    dayPage: null,
    nightLabel: null,
    blindLabel: null,
    overlapTracksAttachment: false,
    addons: [],
    ...overrides,
  };
}

describe("quotationRoomCode", () => {
  it("maps living room and master bedroom to short codes", () => {
    expect(quotationRoomCode({ type: "Living Room", label: "Living Room" })).toBe("LR");
    expect(quotationRoomCode({ type: "Master Bedroom", label: "Master Bedroom" })).toBe("MB");
  });

  it("maps numbered bedrooms to BR<n> whatever follows the number", () => {
    expect(quotationRoomCode({ type: "Bedroom", label: "Bedroom 3 (Samuel’s Study)" })).toBe("BR3");
    expect(quotationRoomCode({ type: "Bedroom", label: "Bedroom 1 Right" })).toBe("BR1");
    expect(quotationRoomCode({ type: "Bedroom", label: "Bedroom 10" })).toBe("BR10");
  });

  it("falls back to the trimmed label for anything else", () => {
    expect(quotationRoomCode({ type: "Service Yard", label: "Service Yard" })).toBe("Service Yard");
    expect(quotationRoomCode({ type: "Other", label: "  Entertainment Left  " })).toBe("Entertainment Left");
    expect(quotationRoomCode({ type: "Bedroom", label: "Bedroom (Daughter’s room)" })).toBe("Bedroom (Daughter’s room)");
  });
});

describe("buildFabricSelectionNotes", () => {
  it("renders Samuel's order DW-2026-0042 exactly as typed in Zoho", () => {
    const notes = buildFabricSelectionNotes({
      rooms: [
        { id: "lr", type: "Living Room", label: "Living Room" },
        { id: "mb", type: "Master Bedroom", label: "Master Bedroom" },
        { id: "b1", type: "Bedroom", label: "Bedroom 1" },
        { id: "b2", type: "Bedroom", label: "Bedroom 2" },
        { id: "b3", type: "Bedroom", label: "Bedroom 3 (Samuel’s Study)" },
        { id: "b4", type: "Bedroom", label: "Bedroom 4 (Wife’s study)" },
      ],
      windows: [
        window({ roomId: "lr", dayLabel: "155301-02", dayPage: "P30", nightLabel: "清风麻-4 蔷薇奶白" }),
        window({ roomId: "mb", nightLabel: "清风麻-1 杏仁奶心", addons: [{ key: "blackout", autoRule: "manual", label: "Blackout" }] }),
        window({ roomId: "b1", nightLabel: "清风麻-4 蔷薇奶白" }),
        window({ roomId: "b2", nightLabel: "清风麻-4 蔷薇奶白" }),
        window({ roomId: "b3", dayLabel: "155301-02", dayPage: "P30", nightLabel: "清风麻-10 霜林晚归" }),
        window({ roomId: "b4", dayLabel: "155301-02", dayPage: "P30", nightLabel: "清风麻-7 粉黛桃花" }),
      ],
    });
    expect(notes).toBe([
      "Fabric Selections:",
      "LR: Day P30 — 155301-02, Night 清风麻-4 蔷薇奶白",
      "MB: Night 清风麻-1 杏仁奶心, add blackout",
      "BR1: Night 清风麻-4 蔷薇奶白",
      "BR2: Night 清风麻-4 蔷薇奶白",
      "BR3: Day P30 — 155301-02, Night 清风麻-10 霜林晚归",
      "BR4: Day P30 — 155301-02, Night 清风麻-7 粉黛桃花",
    ].join("\n"));
  });

  it("keeps rooms with identical fabrics on separate lines", () => {
    const notes = buildFabricSelectionNotes({
      rooms: [
        { id: "b1", type: "Bedroom", label: "Bedroom 1" },
        { id: "b2", type: "Bedroom", label: "Bedroom 2" },
      ],
      windows: [
        window({ roomId: "b1", nightLabel: "清风麻-4 蔷薇奶白" }),
        window({ roomId: "b2", nightLabel: "清风麻-4 蔷薇奶白" }),
      ],
    });
    expect(notes).toBe("Fabric Selections:\nBR1: Night 清风麻-4 蔷薇奶白\nBR2: Night 清风麻-4 蔷薇奶白");
  });

  it("uses the room label for unmapped room types", () => {
    const notes = buildFabricSelectionNotes({
      rooms: [
        { id: "sy", type: "Service Yard", label: "Service Yard" },
        { id: "d", type: "Bedroom", label: "Bedroom (Daughter’s room)" },
      ],
      windows: [
        window({ roomId: "sy", blindLabel: "Roller Blind Grey" }),
        window({ roomId: "d", nightLabel: "Linen" }),
      ],
    });
    expect(notes).toBe("Fabric Selections:\nService Yard: Blind Roller Blind Grey\nBedroom (Daughter’s room): Night Linen");
  });

  it("omits the day page when null and hides slim_tracks and auto add-ons", () => {
    const notes = buildFabricSelectionNotes({
      rooms: [{ id: "lr", type: "Living Room", label: "Living Room" }],
      windows: [
        window({
          roomId: "lr",
          dayLabel: "Linen Day",
          nightLabel: "Night Fabric",
          addons: [
            { key: "slim_tracks", autoRule: "manual", label: "Slim Tracks" },
            { key: "extra_shipping", autoRule: "always", label: "Extra Shipping" },
            { key: "wide_fabric", autoRule: "width_over", label: "Wide Fabric" },
            { key: "s_fold", autoRule: "manual", label: "S-Fold" },
          ],
        }),
      ],
    });
    expect(notes).toBe("Fabric Selections:\nLR: Day Linen Day, Night Night Fabric, add s-fold");
  });

  it("merges identical windows in a room and splits differing ones", () => {
    const notes = buildFabricSelectionNotes({
      rooms: [{ id: "lr", type: "Living Room", label: "Living Room" }],
      windows: [
        window({ roomId: "lr", nightLabel: "Same" }),
        window({ roomId: "lr", nightLabel: "Same" }),
      ],
    });
    expect(notes).toBe("Fabric Selections:\nLR: Night Same");

    const split = buildFabricSelectionNotes({
      rooms: [{ id: "lr", type: "Living Room", label: "Living Room" }],
      windows: [
        window({ roomId: "lr", nightLabel: "A" }),
        window({ roomId: "lr", nightLabel: "B" }),
      ],
    });
    expect(split).toBe("Fabric Selections:\nLR: Night A\nLR: Night B");
  });

  it("summarises overlap attachments for all rooms when every shown room has one", () => {
    const notes = buildFabricSelectionNotes({
      rooms: [
        { id: "lr", type: "Living Room", label: "Living Room" },
        { id: "mb", type: "Master Bedroom", label: "Master Bedroom" },
        { id: "b1", type: "Bedroom", label: "Bedroom 1" },
        { id: "b2", type: "Bedroom", label: "Bedroom 2" },
      ],
      windows: [
        window({ roomId: "lr", nightLabel: "A", overlapTracksAttachment: true }),
        window({ roomId: "mb", nightLabel: "B", overlapTracksAttachment: true }),
        window({ roomId: "b1", nightLabel: "C", overlapTracksAttachment: true }),
        window({ roomId: "b2", nightLabel: "D", overlapTracksAttachment: true }),
      ],
    });
    expect(notes).toContain("Overlap attachment for all rooms, 4 pairs");
  });

  it("names the flagged rooms when only some have overlap attachments", () => {
    const notes = buildFabricSelectionNotes({
      rooms: [
        { id: "lr", type: "Living Room", label: "Living Room" },
        { id: "mb", type: "Master Bedroom", label: "Master Bedroom" },
        { id: "b1", type: "Bedroom", label: "Bedroom 1" },
      ],
      windows: [
        window({ roomId: "lr", nightLabel: "A", overlapTracksAttachment: true }),
        window({ roomId: "mb", nightLabel: "B", overlapTracksAttachment: true }),
        window({ roomId: "b1", nightLabel: "C" }),
      ],
    });
    expect(notes).toContain("Overlap attachment for LR and MB, 2 pairs");
  });

  it("uses the singular for one overlap pair", () => {
    const notes = buildFabricSelectionNotes({
      rooms: [
        { id: "lr", type: "Living Room", label: "Living Room" },
        { id: "mb", type: "Master Bedroom", label: "Master Bedroom" },
      ],
      windows: [
        window({ roomId: "lr", nightLabel: "A", overlapTracksAttachment: true }),
        window({ roomId: "mb", nightLabel: "B" }),
      ],
    });
    expect(notes).toContain("Overlap attachment for LR, 1 pair");
  });

  it("returns an empty string when nothing is selected", () => {
    expect(buildFabricSelectionNotes({ rooms: [], windows: [] })).toBe("");
    expect(buildFabricSelectionNotes({
      rooms: [{ id: "lr", type: "Living Room", label: "Living Room" }],
      windows: [window({ roomId: "lr", overlapTracksAttachment: true })],
    })).toBe("");
  });
});
