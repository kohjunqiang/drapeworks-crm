import "server-only";

// The single reader of "what goes on this order's purchase orders".
//
// Same arrangement as manufacture/load.ts, for the same reason: the generate
// action writes the documents and the frozen screen explains why there are
// none. If those two assembled their own inputs they could disagree — the
// screen listing one missing label while generation refuses over another — and
// the person trying to fix it would be chasing a moving target.
//
// buildPos is pure and decides nothing about the world; this module is the
// world. Everything it cannot answer comes back as a PROBLEM STRING naming what
// is missing, never as a default, because every cell of a 采购订单 is a cutting
// instruction and the phase exists to stop us printing a guess.

import { db } from "@/lib/db/kysely";
import type { RoomType } from "@/lib/db/schema";
import { STATUS_LABELS, statusIndex } from "@/lib/status-flow";

import type { PoInput, PoLine, PoRoomLabel, PoVendor } from "./build";

export type PoLoad = {
  /** Null when the order cannot produce a document at all; see `problems`. */
  input: PoInput | null;
  problems: string[];
};

// Positions are 0-based in the database and 1-based on every screen, and this
// string is read beside the reconciliation grid.
function locate(roomLabel: string, position: number): string {
  return `${roomLabel} Window ${position + 1}`;
}

/**
 * CUST REF — who the order is for, in the words the business already uses.
 *
 * The sample prints `Omar Tampines 957B 08-146`: a customer, a development, a
 * unit. We hold the first three; the trailing figure on the sample is off-system.
 * Composed from what we have rather than left blank, because this is the line a
 * vendor quotes back when they ring about a document — and unlike every Chinese
 * cell on the page, it is OURS to write.
 */
function custRefOf(order: {
  customer_name: string;
  development: string | null;
  unit_type: string | null;
}): string | null {
  const parts = [order.customer_name, order.development, order.unit_type]
    .map((p) => p?.trim())
    .filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join(" ") : null;
}

export async function loadPoInput(
  orderId: string,
  generatedAt: Date,
): Promise<PoLoad> {
  const order = await db
    .selectFrom("orders")
    .innerJoin("customers", "customers.id", "orders.customer_id")
    .select([
      "orders.order_reference as order_reference",
      "orders.current_status as current_status",
      "orders.freight_mode as freight_mode",
      "orders.product_line as product_line",
      "orders.delivery_vendor_id as delivery_vendor_id",
      "orders.development as development",
      "orders.unit_type as unit_type",
      "customers.name as customer_name",
    ])
    .where("orders.id", "=", orderId)
    .executeTakeFirst();

  if (!order) return { input: null, problems: ["That order no longer exists."] };

  const problems: string[] = [];

  // Nothing is frozen before sent_to_vendor, so there are no manufacturing
  // dimensions to print — only candidates, which is precisely what must never
  // reach a factory.
  if (statusIndex(order.current_status) < statusIndex("sent_to_vendor")) {
    problems.push(
      `This order is at "${STATUS_LABELS[order.current_status]}". Its manufacturing measurements are not frozen yet, so there is nothing to send a vendor.`,
    );
  }

  const poNumber = order.order_reference?.trim() ?? "";
  if (!poNumber) {
    problems.push(
      "This order has no order reference, and the reference IS the PO number. Set one on the order before generating.",
    );
  }

  // Mesh is not modelled on the document: PoLine.kind is curtain or blind, the
  // fourth column is 面料米数 or 平方, and no sample carries a mesh panel.
  // po_type_labels keeps a null `mesh` row so the eventual answer has somewhere
  // to go. Saying so is much better than generating an empty document.
  if (order.product_line === "mesh") {
    problems.push(
      "This is a mesh order. Purchase orders cover curtains and blinds only — mesh panels are not on the document yet.",
    );
    return { input: null, problems };
  }

  const [
    settings,
    assumptions,
    roomLabelRows,
    typeLabelRows,
    openingRows,
    vendorRows,
    delivery,
  ] = await Promise.all([
      db
        .selectFrom("procurement_settings")
        .selectAll()
        .where("singleton", "=", true)
        .executeTakeFirst(),
      db
        .selectFrom("pricing_assumptions")
        .select("style_multiplier")
        .executeTakeFirst(),
      db.selectFrom("room_type_labels").select(["room_type", "name_cn", "code"]).execute(),
      db.selectFrom("po_type_labels").select(["key", "label_cn"]).execute(),
      db.selectFrom("po_opening_labels").select(["draw", "label_cn"]).execute(),
      // Archived vendors included: an order placed before a vendor was archived
      // still has to name that vendor on its document.
      db
        .selectFrom("vendors")
        .select(["id", "name", "name_cn", "address_cn", "phone", "internal_ref"])
        .execute(),
      // Where this order ships. The one it names, or — far more often — the
      // one marked default, which a unique partial index guarantees there is at
      // most one of, so this cannot silently pick between two.
      //
      // An order's own choice is honoured even if that address has since been
      // archived: it is where the goods are going, and quietly redirecting a
      // shipment to a different warehouse because somebody tidied up an admin
      // screen is not a correction. Archiving only stops it being CHOSEN.
      order.delivery_vendor_id
        ? db
            .selectFrom("delivery_vendors")
            .select(["shipping_mark_cn", "address_cn", "recipient_cn", "phone"])
            .where("id", "=", order.delivery_vendor_id)
            .executeTakeFirst()
        : db
            .selectFrom("delivery_vendors")
            .select(["shipping_mark_cn", "address_cn", "recipient_cn", "phone"])
            .where("is_default", "=", true)
            .where("is_active", "=", true)
            .executeTakeFirst(),
    ]);

  if (!settings) {
    problems.push(
      "The company letterhead has not been set up. Fill it in under Admin → Procurement before generating.",
    );
  }
  if (!assumptions) {
    problems.push(
      "There are no pricing assumptions, so the fullness (窗帘褶皱) that every curtain is cut to is unknown.",
    );
  }

  const typeLabels = new Map(typeLabelRows.map((r) => [r.key, r.label_cn]));
  const openingLabels = new Map(openingRows.map((r) => [r.draw, r.label_cn]));
  const roomLabels = new Map<string, PoRoomLabel>(
    roomLabelRows.map((r) => [
      r.room_type as RoomType,
      { nameCn: r.name_cn, code: r.code },
    ]),
  );

  const { lines, problems: lineProblems } = await loadLines(
    orderId,
    typeLabels,
    openingLabels,
  );
  problems.push(...lineProblems);

  // Only when nothing else has already said why. Every skipped window has named
  // itself above, and repeating the total underneath reads as a second, separate
  // fault — the list is meant to be a to-do, not an echo.
  if (lines.length === 0 && lineProblems.length === 0) {
    problems.push(
      "This order has nothing a vendor could make: no window carries a curtain or a blind.",
    );
  }

  // Any problem at all means no input: this module hands back a document's
  // worth of facts or a list of what is wrong, never a half of each.
  if (problems.length > 0 || !settings || !assumptions) {
    return { input: null, problems: [...new Set(problems)] };
  }

  // Notes carried forward from the documents currently in force, per vendor, so
  // that regenerating after an amendment does not silently drop the Night
  // sample's 都要绑带 off the reissued page.
  const current = await db
    .selectFrom("manufacture_pos")
    .select(["vendor_id", "notes"])
    .where("order_id", "=", orderId)
    .where("superseded_at", "is", null)
    .execute();
  const notesByVendorId = new Map<string, string | null>();
  for (const row of current) {
    if (row.vendor_id) notesByVendorId.set(row.vendor_id, row.notes);
  }

  const vendors: PoVendor[] = vendorRows.map((v) => ({
    id: v.id,
    name: v.name,
    nameCn: v.name_cn,
    addressCn: v.address_cn,
    phone: v.phone,
    internalRef: v.internal_ref,
  }));

  return {
    input: {
      settings: {
        companyName: settings.company_name,
        companyUen: settings.company_uen,
        addressLine1: settings.address_line1,
        addressLine2: settings.address_line2,
        phone: settings.phone,
        wechat: settings.wechat,
        website: settings.website,
        curtainStyleCn: settings.curtain_style_cn,
        heatSettingCn: settings.heat_setting_cn,
        floorClearanceCm: settings.floor_clearance_cm,
      },
      poNumber,
      custRef: custRefOf(order),
      generatedAt,
      freightMode: order.freight_mode,
      // The current 收货地址. Null is not a refusal: the block is air-only and
      // every line in it is optional on the samples, so a document without one
      // is a document with no delivery block — not a wrong one.
      delivery: delivery
        ? {
            airShippingMark: delivery.shipping_mark_cn,
            warehouseAddressCn: delivery.address_cn,
            recipientCn: delivery.recipient_cn,
            phone: delivery.phone,
          }
        : null,
      fullnessBps: assumptions.style_multiplier,
      vendors,
      roomLabels,
      lines,
      notesByVendorId,
    },
    problems: [],
  };
}

/** What distinguishes one covering on a window from another on the same one. */
type Covering = Pick<
  PoLine,
  "lineId" | "vendorId" | "kind" | "typeLabel" | "fabricLabel"
>;

/**
 * Windows split into COVERINGS — the rows of the table.
 *
 * A window carrying both a day and a night curtain is two coverings, and on the
 * Omar order those two went to different vendors and so onto different
 * documents. buildPos only ever groups; splitting is this function's job.
 */
async function loadLines(
  orderId: string,
  typeLabels: Map<string, string | null>,
  openingLabels: Map<string, string | null>,
): Promise<{ lines: PoLine[]; problems: string[] }> {
  const rows = await db
    .selectFrom("windows")
    .innerJoin("rooms", "rooms.id", "windows.room_id")
    // The FROZEN dimensions, and only those. A window with no row was never
    // confirmed, and recomputing a candidate here would put a number the vendor
    // has not been given onto a document that says it is a finished size.
    .leftJoin("manufacture_measurements as mm", "mm.window_id", "windows.id")
    .leftJoin("curtain_types as day_ct", "day_ct.id", "windows.day_curtain_type_id")
    .leftJoin("curtain_series as day_cs", "day_cs.id", "day_ct.series_id")
    .leftJoin("curtain_types as night_ct", "night_ct.id", "windows.night_curtain_type_id")
    .leftJoin("curtain_series as night_cs", "night_cs.id", "night_ct.series_id")
    .leftJoin("curtain_types as toilet_ct", "toilet_ct.id", "windows.curtain_type_id")
    .leftJoin("curtain_series as toilet_cs", "toilet_cs.id", "toilet_ct.series_id")
    .leftJoin("curtain_types as blind_ct", "blind_ct.id", "windows.blind_type_id")
    .leftJoin("curtain_series as blind_cs", "blind_cs.id", "blind_ct.series_id")
    .select([
      "windows.id as id",
      "windows.position as position",
      "windows.draw as draw",
      "windows.blind_type_id as blind_type_id",
      "rooms.id as room_id",
      "rooms.label as room_label",
      "rooms.type as room_type",
      "rooms.position as room_position",
      "mm.mfg_width_cm as mfg_width_cm",
      "mm.mfg_height_cm as mfg_height_cm",
      "day_ct.label as day_label",
      "day_cs.vendor_id as day_vendor_id",
      "night_ct.label as night_label",
      "night_cs.vendor_id as night_vendor_id",
      "toilet_ct.label as toilet_label",
      "toilet_cs.vendor_id as toilet_vendor_id",
      "blind_ct.label as blind_label",
      "blind_cs.vendor_id as blind_vendor_id",
      "blind_cs.name_cn as blind_name_cn",
    ])
    .where("rooms.order_id", "=", orderId)
    .orderBy("rooms.position", "asc")
    .orderBy("windows.position", "asc")
    .execute();

  const lines: PoLine[] = [];
  const problems: string[] = [];

  for (const w of rows) {
    const where = locate(w.room_label, w.position);

    // 开法. A window with no draw direction recorded is a different failure from
    // a draw direction with no Chinese, and sending someone to Admin →
    // Procurement (which is what buildPos would say) would be the wrong advice.
    const opening = w.draw ? (openingLabels.get(w.draw) ?? null) : null;
    if (!w.draw) {
      problems.push(
        `${where} has no draw direction recorded, so its 开法 cell has nothing to say.`,
      );
    }

    const base = {
      roomId: w.room_id,
      roomLabel: w.room_label,
      roomType: w.room_type,
      roomPosition: w.room_position,
      position: w.position,
      openingLabel: opening,
    };

    // A window is ONE covering — day/night curtains, a single toilet curtain, or
    // a blind, never a mix — so this is an either/or, not a priority list.
    const coverings: Covering[] = [];

    if (w.blind_type_id) {
      coverings.push({
        lineId: `${w.id}:blind`,
        vendorId: w.blind_vendor_id,
        kind: "blind",
        // Blind wording is per SERIES — 卷帘 is a roller specifically, and a
        // Roman is a different word. po_type_labels('blind') is a fallback that
        // is seeded null on purpose, so it cannot mislabel a Roman as a roller.
        typeLabel: w.blind_name_cn ?? typeLabels.get("blind") ?? null,
        fabricLabel: w.blind_label,
      });
    } else {
      if (w.day_label) {
        coverings.push({
          lineId: `${w.id}:day`,
          vendorId: w.day_vendor_id,
          kind: "curtain",
          typeLabel: typeLabels.get("day") ?? null,
          fabricLabel: w.day_label,
        });
      }
      if (w.night_label) {
        coverings.push({
          lineId: `${w.id}:night`,
          vendorId: w.night_vendor_id,
          kind: "curtain",
          typeLabel: typeLabels.get("night") ?? null,
          fabricLabel: w.night_label,
        });
      }
      if (w.toilet_label) {
        coverings.push({
          lineId: `${w.id}:toilet`,
          vendorId: w.toilet_vendor_id,
          kind: "curtain",
          typeLabel: typeLabels.get("toilet") ?? null,
          fabricLabel: w.toilet_label,
        });
      }
    }

    if (coverings.length === 0) {
      problems.push(
        `${where} has no curtain or blind on it, so there is nothing to order for it.`,
      );
      continue;
    }

    if (w.mfg_width_cm == null || w.mfg_height_cm == null) {
      // The reconciliation screen shows this window; a document that quietly
      // omitted it would differ from what the person confirming just read.
      problems.push(
        `${where} has no frozen manufacturing measurement. Confirm the measurements for this order again.`,
      );
      continue;
    }

    for (const covering of coverings) {
      lines.push({
        ...base,
        ...covering,
        mfgWidthCm: w.mfg_width_cm,
        mfgHeightCm: w.mfg_height_cm,
      });
    }
  }

  return { lines, problems };
}
