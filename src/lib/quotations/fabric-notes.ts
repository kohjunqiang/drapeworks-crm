// Builds the "Fabric Selections:" block consultants used to type into Zoho
// Books by hand, so a new quotation's Notes field starts pre-filled. Pure —
// the order page maps DB rows into these plain shapes.

export type FabricNoteRoom = {
  id: string;
  type: string;
  label: string;
};

export type FabricNoteAddon = {
  key: string;
  autoRule: string;
  label: string;
};

export type FabricNoteWindow = {
  roomId: string;
  dayLabel: string | null;
  dayPage: string | null;
  nightLabel: string | null;
  blindLabel: string | null;
  overlapTracksAttachment: boolean;
  addons: FabricNoteAddon[];
};

const BEDROOM_NUMBER = /^Bedroom\s+(\d+)/;

// Short room code the team uses on Zoho quotes: LR, MB, BR<n> for numbered
// bedrooms, otherwise the room label verbatim.
export function quotationRoomCode(room: { type: string; label: string }): string {
  if (room.type === "Living Room") return "LR";
  if (room.type === "Master Bedroom") return "MB";
  if (room.type === "Bedroom") {
    const match = BEDROOM_NUMBER.exec(room.label.trim());
    if (match) return `BR${match[1]}`;
  }
  return room.label.trim();
}

// One window's fabric description, or null when nothing was selected (such a
// window contributes nothing — including its add-ons and track flags).
function windowBody(window: FabricNoteWindow): string | null {
  const parts: string[] = [];
  if (window.blindLabel) {
    parts.push(`Blind ${window.blindLabel}`);
  } else {
    if (window.dayLabel) {
      parts.push(window.dayPage ? `Day ${window.dayPage} — ${window.dayLabel}` : `Day ${window.dayLabel}`);
    }
    if (window.nightLabel) parts.push(`Night ${window.nightLabel}`);
  }
  if (parts.length === 0) return null;
  for (const addon of window.addons) {
    if (addon.autoRule !== "manual" || addon.key === "slim_tracks") continue;
    parts.push(`add ${addon.label.toLowerCase()}`);
  }
  return parts.join(", ");
}

function joinCodes(codes: string[]): string {
  if (codes.length <= 2) return codes.join(" and ");
  return `${codes.slice(0, -1).join(", ")} and ${codes[codes.length - 1]}`;
}

export function buildFabricSelectionNotes(input: {
  rooms: FabricNoteRoom[];
  windows: FabricNoteWindow[];
}): string {
  const windowsByRoom = new Map<string, FabricNoteWindow[]>();
  for (const window of input.windows) {
    const list = windowsByRoom.get(window.roomId) ?? [];
    list.push(window);
    windowsByRoom.set(window.roomId, list);
  }

  const lines: string[] = [];
  const shownRooms: { id: string; code: string }[] = [];
  const flaggedRoomIds = new Set<string>();
  let overlapCount = 0;

  for (const room of input.rooms) {
    const bodies: string[] = [];
    let flagged = 0;
    for (const window of windowsByRoom.get(room.id) ?? []) {
      const body = windowBody(window);
      if (body === null) continue;
      if (window.overlapTracksAttachment) flagged += 1;
      if (!bodies.includes(body)) bodies.push(body);
    }
    if (bodies.length === 0) continue;
    const code = quotationRoomCode(room);
    shownRooms.push({ id: room.id, code });
    for (const body of bodies) lines.push(`${code}: ${body}`);
    if (flagged > 0) {
      flaggedRoomIds.add(room.id);
      overlapCount += flagged;
    }
  }

  if (lines.length === 0) return "";
  const output = ["Fabric Selections:", ...lines];
  if (overlapCount > 0) {
    const scope = flaggedRoomIds.size === shownRooms.length
      ? "all rooms"
      : joinCodes([...new Set(shownRooms.filter((room) => flaggedRoomIds.has(room.id)).map((room) => room.code))]);
    output.push(`Overlap attachment for ${scope}, ${overlapCount} ${overlapCount === 1 ? "pair" : "pairs"}`);
  }
  return output.join("\n");
}
