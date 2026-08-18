// Everything the Chinese purchase order (采购订单) prints, derived from the
// frozen manufacturing measurements.
//
// Pure on purpose, and for a specific reason: the reconciliation screen previews
// the documents and the generate action writes them. If those two derived their
// own rows they could disagree — a preview showing four windows while the PDF
// carries three — and the difference would only surface on a cutting table in
// Shenzhen. Same shape as manufacture/preconditions.ts: hand it already-loaded
// rows, get back what to render plus what is wrong with it.
//
// NOTHING HERE READS THE DATABASE, THE CLOCK OR THE FILESYSTEM.
//
// The arithmetic is checked against resource/documents/40 Omar 957B
// Tampines_{Day,Night,Blinds} PO.pdf, which are the only specification it has.

import type { FreightMode, RoomType } from "@/lib/db/schema";

/** The singleton procurement_settings row, as the document needs it. */
export type PoSettings = {
  companyName: string;
  companyUen: string;
  addressLine1: string;
  addressLine2: string;
  phone: string;
  wechat: string;
  website: string;
  airShippingMark: string | null;
  warehouseAddressCn: string | null;
  recipientCn: string | null;
  deliveryPhone: string | null;
  curtainStyleCn: string | null;
  heatSettingCn: string | null;
  floorClearanceCm: number | null;
};

/** A vendor's 供应商 block. Every contact field is optional; see `problems`. */
export type PoVendor = {
  id: string;
  name: string;
  nameCn: string | null;
  addressCn: string | null;
  phone: string | null;
  internalRef: string | null;
};

/**
 * One covering, which is one row of the table.
 *
 * NOT one window: a window carrying both a day and a night curtain is two
 * coverings, and on the Omar order those two went to different vendors and so
 * onto different documents. The caller splits windows into coverings; this
 * module only ever groups.
 */
export type PoLine = {
  /** Stable id for the covering — used only for the caller's own bookkeeping. */
  lineId: string;
  /** `curtain_series.vendor_id`. Null means the series has no vendor set. */
  vendorId: string | null;
  roomId: string;
  /** The consultant's own room label, used to NAME PROBLEMS, never printed. */
  roomLabel: string;
  roomType: RoomType;
  roomPosition: number;
  /** 0-based position of the window within its room. */
  position: number;
  /** Decides the fourth column: fabric length for curtains, area for blinds. */
  kind: "curtain" | "blind";
  /**
   * 窗帘款式 cell — "窗帘 Night", "纱窗 Day", "卷帘". Printed verbatim.
   *
   * Null means po_type_labels (or the blind's curtain_series.name_cn) has no
   * Chinese for this piece yet. buildPos REFUSES on null; it does not print an
   * empty cell. See the note on openingLabel.
   */
  typeLabel: string | null;
  /** 型号 cell — the catalogue label. Printed verbatim; it is a vendor's code. */
  fabricLabel: string | null;
  /**
   * 开法 cell — "对开 Double draw", "要罩盒 - with cover". Verbatim.
   *
   * Null means po_opening_labels has no Chinese for this draw direction. Only
   * 对开 Double draw is evidenced by the samples; Single Left and Single Right
   * are seeded NULL and wait for the business.
   */
  openingLabel: string | null;
  mfgWidthCm: number;
  mfgHeightCm: number;
};

/**
 * A row of room_type_labels: 客厅 + LR.
 *
 * `nameCn` is nullable because a row can be half-known: Service Yard's code SR
 * is evidenced by the Blinds sample, its Chinese name is not. That is the same
 * state as having no row at all — "we do not know" — and buildPos gives the two
 * the same behaviour, which is to refuse.
 */
export type PoRoomLabel = { nameCn: string | null; code: string };

export type PoInput = {
  settings: PoSettings;
  /** orders.order_reference, snapshotted by the caller. */
  poNumber: string;
  custRef: string | null;
  invoiceRef: string | null;
  /** Passed in rather than read, so the same input always builds the same PO. */
  generatedAt: Date;
  freightMode: FreightMode;
  /** pricing_assumptions.style_multiplier — 20000 bps is 2.0. */
  fullnessBps: number;
  vendors: readonly PoVendor[];
  roomLabels: ReadonlyMap<string, PoRoomLabel>;
  lines: readonly PoLine[];
  /** manufacture_pos.notes, per vendor — the Night sample's 都要绑带. */
  notesByVendorId?: ReadonlyMap<string, string | null>;
};

/** One table row, fully formatted. The renderer prints these strings as-is. */
export type PoRow = {
  /** 房间 Room — "客厅 LR", "次卧 1 BR1". */
  room: string;
  /** 窗帘款式 Type. */
  type: string;
  /** 型号 Fabric. */
  fabric: string;
  /** 面料米数 for curtains, 平方 for blinds — see the table's columnSet. */
  derived: string;
  /** 窗宽 Width (M). */
  widthM: string;
  /** 窗高 Height (M). */
  heightM: string;
  /** 开法 Opening. */
  opening: string;
};

/**
 * A run of rows sharing a fourth column.
 *
 * Normally a document has exactly one. A vendor supplying both curtains and
 * blinds gets two, because 面料米数 and 平方 are different quantities and one
 * header cannot honestly cover both. The samples never mix, but
 * curtain_series.vendor_id permits it.
 */
export type PoTable = { columnSet: "curtain" | "blind"; rows: PoRow[] };

/** 订单资料 — curtain-only; blank on the Blinds sample. */
export type PoOrderDetails = {
  styleCn: string | null;
  heatSettingCn: string | null;
  fullnessLabel: string;
  floorClearanceCm: number | null;
};

/** 收货地址 — air freight only. */
export type PoDelivery = {
  airShippingMark: string | null;
  warehouseAddressCn: string | null;
  recipientCn: string | null;
  phone: string | null;
};

/**
 * One rendered document. Everything is already resolved and formatted so the
 * renderer decides nothing: no arithmetic, no conditionals on freight mode, no
 * "is this a curtain" in the component.
 */
export type PoDocData = {
  settings: PoSettings;
  vendor: PoVendor;
  poNumber: string;
  custRef: string | null;
  invoiceRef: string | null;
  dateLabel: string;
  /** Null on a sea order: the block we have is the AIR one. */
  delivery: PoDelivery | null;
  /** Null when the document carries no curtains: the four labels print empty. */
  orderDetails: PoOrderDetails | null;
  tables: PoTable[];
  notes: string | null;
};

// ── Numbers ────────────────────────────────────────────────────────────────
//
// The document is in metres to two decimals; storage is integer centimetres.
// A centimetre IS a hundredth of a metre, so every quantity below is carried as
// an integer count of hundredths and formatted once, at the end. That is not
// fastidiousness: 2.67 m × 2.5 is 6.675 exactly, but the double nearest 2.67 is
// a shade under, so multiplying the metres yields 6.67 while the centimetres
// yield 6.68. A fabric length that disagrees with the width printed beside it
// is a phone call from the factory.

/** Formats a signed integer count of hundredths as "2.74", "2.50", "0.05". */
function formatHundredths(hundredths: number): string {
  const sign = hundredths < 0 ? "-" : "";
  const abs = Math.abs(hundredths);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${sign}${whole}.${String(frac).padStart(2, "0")}`;
}

/** 274 → "2.74". Padded to 2dp: 250 → "2.50", never "2.5". */
export function cmToM(cm: number): string {
  return formatHundredths(Math.round(cm));
}

/**
 * 面料米数 = width × fullness, in metres.
 *
 * 274 cm at 2.0 → "5.48", reproducing the Night sample.
 */
export function fabricLengthM(widthCm: number, fullnessBps: number): string {
  // widthCm is already hundredths of a metre; fullnessBps is ten-thousandths.
  return formatHundredths(Math.round((widthCm * fullnessBps) / 10_000));
}

/**
 * 平方 = width × height, in square metres.
 *
 * 205 × 120 cm → "2.46", reproducing the Blinds sample.
 */
export function sqmM(widthCm: number, heightCm: number): string {
  // cm² → hundredths of a m²: divide by 10 000 for m², multiply by 100 back.
  return formatHundredths(Math.round((widthCm * heightCm) / 100));
}

/**
 * "客厅 LR", or "次卧 1 BR1" when the type repeats within one document.
 *
 * Name first, then code — always. The Blinds sample prints "SR Service Yard"
 * the other way round, but only because that row has no Chinese at all and the
 * document fell back to the English name; the layout it would have used with a
 * Chinese name is the one every other row on every sample shows.
 *
 * TOTAL BY CONSTRUCTION: it takes a name, so it cannot be asked to render an
 * absent one. Deciding what to do about a missing label is buildPos's job.
 */
export function roomLabel(
  nameCn: string,
  code: string,
  index: number | null,
): string {
  return index == null
    ? `${nameCn} ${code}`
    : `${nameCn} ${index} ${code}${index}`;
}

/** 窗帘褶皱 — 20000 bps prints as the samples' "2 倍". */
export function fullnessLabel(bps: number): string {
  const whole = Math.floor(bps / 10_000);
  const frac = String(bps % 10_000).padStart(4, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac} 倍` : `${whole} 倍`;
}

/** "08 August 2026", as the samples print the date. */
export function formatPoDate(at: Date): string {
  // Singapore time: the business's day, not the server's.
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Singapore",
  }).format(at);
}

// ── Assembly ───────────────────────────────────────────────────────────────

function locate(line: PoLine): string {
  // position is 0-based in the database and 1-based on every screen. Naming
  // "window 0" sends the reader hunting for a row that is not on their page.
  return `${line.roomLabel} Window ${line.position + 1}`;
}

/**
 * Numbers the rooms of ONE document: rooms sharing a room_type are numbered by
 * rooms.position, and a type appearing once is not numbered at all — the
 * samples show a bare 客厅 LR, never LR1.
 *
 * Per document rather than per order, per spec §3.4. Note the consequence: if
 * one bedroom's day curtain goes to a different vendor from the other's, each
 * vendor sees an unnumbered 次卧 BR. Each document is self-consistent, which is
 * what the vendor reading it needs.
 */
function numberRooms(lines: readonly PoLine[]): Map<string, number | null> {
  const byType = new Map<RoomType, { roomId: string; position: number }[]>();
  const seen = new Set<string>();

  for (const line of lines) {
    if (seen.has(line.roomId)) continue;
    seen.add(line.roomId);
    const rooms = byType.get(line.roomType) ?? [];
    rooms.push({ roomId: line.roomId, position: line.roomPosition });
    byType.set(line.roomType, rooms);
  }

  const indexes = new Map<string, number | null>();
  for (const rooms of byType.values()) {
    rooms.sort((a, b) => a.position - b.position);
    for (const [i, room] of rooms.entries()) {
      indexes.set(room.roomId, rooms.length > 1 ? i + 1 : null);
    }
  }
  return indexes;
}

/**
 * A line that has passed every check in buildPos, carrying the strings it will
 * print already resolved.
 *
 * Having a separate type is the point rather than ceremony: on this side of the
 * boundary nothing is nullable, so no `?? ""` downstream can quietly drop a
 * blank cell onto a cutting instruction. Everything nullable is decided ONCE,
 * in buildPos, where a missing value becomes a named problem.
 */
type ReadyLine = {
  line: PoLine;
  /** room_type_labels.name_cn, known to be present. */
  nameCn: string;
  /** room_type_labels.code. */
  code: string;
  typeLabel: string;
  openingLabel: string;
  /** curtain_types.label, verbatim, known to be present. */
  fabricLabel: string;
};

function toRow(ready: ReadyLine, room: string, fullnessBps: number): PoRow {
  const { line } = ready;
  return {
    room,
    // Catalogue and type labels verbatim — they are the vendor's own language.
    type: ready.typeLabel,
    // NOTE: 型号 is still a nullable pass-through and still renders blank when
    // the caller cannot resolve the catalogue label. It is the last cell in
    // this row that can print empty.
    fabric: ready.fabricLabel,
    derived:
      line.kind === "curtain"
        ? fabricLengthM(line.mfgWidthCm, fullnessBps)
        : sqmM(line.mfgWidthCm, line.mfgHeightCm),
    widthM: cmToM(line.mfgWidthCm),
    heightM: cmToM(line.mfgHeightCm),
    opening: ready.openingLabel,
  };
}

function deliveryOf(input: PoInput): PoDelivery | null {
  // 空运唛头 is literally an AIR shipping mark and the mark itself ends in 空.
  // What a sea shipment prints instead is an open question (spec §8.3), and a
  // wrong shipping mark on a crate is worse than no block at all.
  if (input.freightMode !== "air") return null;

  const { settings } = input;
  const delivery: PoDelivery = {
    airShippingMark: settings.airShippingMark,
    warehouseAddressCn: settings.warehouseAddressCn,
    recipientCn: settings.recipientCn,
    phone: settings.deliveryPhone,
  };
  const empty = Object.values(delivery).every((v) => v == null);
  return empty ? null : delivery;
}

export function buildPos(input: PoInput): {
  pos: PoDocData[];
  problems: string[];
} {
  const problems: string[] = [];
  const vendorsById = new Map(input.vendors.map((v) => [v.id, v]));

  // Room order, then window order within the room. Everything downstream —
  // row order, room numbering, which vendor's document comes first — follows
  // from this one sort, so two runs over the same order cannot differ.
  const ordered = [...input.lines].sort(
    (a, b) => a.roomPosition - b.roomPosition || a.position - b.position,
  );

  // Vendor grouping in first-appearance order. The split is by VENDOR, not by
  // product type: an order whose day and night curtains share a vendor is one
  // document, which is what that vendor wants.
  const byVendor = new Map<string, ReadyLine[]>();

  for (const line of ordered) {
    const label = input.roomLabels.get(line.roomType);
    if (!label) {
      // Named, never blank. A blank room cell on a cutting instruction is a
      // curtain with nowhere to go; an English word on a Chinese one is a
      // guess. Deduplicated below — one unlabelled type would otherwise repeat
      // this once per window.
      problems.push(
        `Room type "${line.roomType}" has no Chinese name and code. Set it under Admin → Procurement before generating.`,
      );
      continue;
    }

    if (label.nameCn == null) {
      // The half-known row: Service Yard has an evidenced code (SR, off the
      // Blinds sample) and no evidenced Chinese at all. Absent row and null
      // name are ONE state — "we do not know" — and they get one behaviour, so
      // that seeding a placeholder to satisfy a NOT NULL can never be the thing
      // that lets English onto a Chinese document.
      problems.push(
        `Room type "${line.roomType}" has no Chinese name. Set it under Admin → Procurement before generating.`,
      );
      continue;
    }

    if (!line.vendorId) {
      problems.push(
        `${locate(line)} has no vendor. Set one on its series before generating.`,
      );
      continue;
    }

    if (!vendorsById.has(line.vendorId)) {
      problems.push(
        `${locate(line)} points at a vendor that no longer exists. Set its series to a current vendor before generating.`,
      );
      continue;
    }

    // 窗帘款式 and 开法. Both are reported together rather than one at a time:
    // they are fixed in the same place, and a person who has just filled in a
    // type label should not have to regenerate to discover the opening label
    // was missing too.
    //
    // Neither may render empty. An empty 窗帘款式 does not say "no style" to a
    // factory, it says nothing, and what happens next is a guess on a cutting
    // table — the exact substitution this phase exists to remove. Most of these
    // labels ARE null today: only 纱窗 Day, 窗帘 Night and 对开 Double draw are
    // evidenced by the samples, and the rest sit null in po_type_labels /
    // po_opening_labels until the business supplies them.
    const { typeLabel, openingLabel } = line;
    if (typeLabel == null) {
      problems.push(
        `${locate(line)} has no 窗帘款式 (type) label. Set it under Admin → Procurement before generating.`,
      );
    }
    if (openingLabel == null) {
      problems.push(
        `${locate(line)} has no 开法 (opening) label. Set it under Admin → Procurement before generating.`,
      );
    }
    // 型号 is the cell that says WHICH FABRIC to cut. A blank one is the worst
    // of the three: a vendor missing a type or an opening will ask, but a
    // vendor missing a fabric code has nothing to ask about.
    const { fabricLabel } = line;
    if (fabricLabel == null) {
      problems.push(
        `${locate(line)} has no 型号 (fabric) label — the catalogue entry it points at is missing one.`,
      );
    }
    if (typeLabel == null || openingLabel == null || fabricLabel == null) {
      continue;
    }

    const lines = byVendor.get(line.vendorId) ?? [];
    lines.push({
      line,
      nameCn: label.nameCn,
      code: label.code,
      typeLabel,
      openingLabel,
      fabricLabel,
    });
    byVendor.set(line.vendorId, lines);
  }

  const dateLabel = formatPoDate(input.generatedAt);
  const delivery = deliveryOf(input);

  const pos: PoDocData[] = [];
  for (const [vendorId, ready] of byVendor) {
    const roomIndexes = numberRooms(ready.map((r) => r.line));

    const rowsFor = (kind: PoLine["kind"]): PoRow[] =>
      ready
        .filter((r) => r.line.kind === kind)
        .map((r) =>
          toRow(
            r,
            roomLabel(r.nameCn, r.code, roomIndexes.get(r.line.roomId)!),
            input.fullnessBps,
          ),
        );

    const curtainRows = rowsFor("curtain");
    const blindRows = rowsFor("blind");

    const tables: PoTable[] = [];
    if (curtainRows.length > 0) {
      tables.push({ columnSet: "curtain", rows: curtainRows });
    }
    if (blindRows.length > 0) {
      tables.push({ columnSet: "blind", rows: blindRows });
    }

    pos.push({
      settings: input.settings,
      vendor: vendorsById.get(vendorId)!,
      poNumber: input.poNumber,
      custRef: input.custRef,
      invoiceRef: input.invoiceRef,
      dateLabel,
      delivery,
      // 订单资料 is curtain-only: every one of its four labels is printed but
      // left blank on the Blinds sample.
      orderDetails:
        curtainRows.length > 0
          ? {
              styleCn: input.settings.curtainStyleCn,
              heatSettingCn: input.settings.heatSettingCn,
              fullnessLabel: fullnessLabel(input.fullnessBps),
              floorClearanceCm: input.settings.floorClearanceCm,
            }
          : null,
      tables,
      notes: input.notesByVendorId?.get(vendorId) ?? null,
    });
  }

  // `pos` is a best-effort preview, not a licence to send. When `problems` is
  // non-empty the caller REFUSES to generate — but the screen can still show
  // the rows that are fine beside the list of what is not, which is how the
  // person fixing it finds the gap.
  return { pos, problems: [...new Set(problems)] };
}
