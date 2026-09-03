// The 采购订单 itself.
//
// Its structure — every label, in this order, with these bilingual headers — is
// taken from resource/documents/40 Omar 957B Tampines_{Day,Night,Blinds} PO.pdf.
// Those three documents are one real order sent to three vendors, and they are
// the only specification this component has. When something here looks odd (a
// half-width `(` against a full-width `）`, a unit with no number in front of
// it), it is because that is what the samples print. See spec §2.
//
// This component DERIVES NOTHING. Every number is already a formatted string and
// every conditional has already been decided in build.ts, so the preview screen
// and the generated PDF cannot come to different conclusions.

import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import type { PoDocData, PoTable } from "./build";

// The family name only — importing render.ts would drag font registration into
// anything that merely wants the component's types.
const FONT = "Noto Sans SC";

// The samples are a navy-on-white spreadsheet: filled bars for section titles, a
// dark header row, hairline-ruled cells. A vendor who has been reading these for
// years should recognise ours at a glance.
const INK = "#000000";
const NAVY = "#44546A";
const TITLE_BLUE = "#2F5597";
const RULE = "#8EA9DB";
const GREY_BAR = "#BFBFBF";
const NOTE_RED = "#C00000";

const styles = StyleSheet.create({
  page: {
    fontFamily: FONT,
    fontSize: 8,
    paddingTop: 28,
    paddingBottom: 36,
    paddingHorizontal: 28,
    color: INK,
  },
  title: {
    fontSize: 15,
    fontWeight: 700,
    color: TITLE_BLUE,
    textAlign: "center",
    marginBottom: 14,
  },

  // ── Header: company block left, order references right ──
  header: { flexDirection: "row" },
  company: { width: "58%" },
  companyName: { fontWeight: 700, marginBottom: 2 },
  companyLine: { marginBottom: 2 },
  refs: { width: "42%" },
  refRow: { flexDirection: "row", marginBottom: 2, alignItems: "center" },
  refLabel: { width: "38%", fontWeight: 700, textAlign: "right", paddingRight: 6 },
  refValue: {
    width: "62%",
    borderBottomWidth: 0.5,
    borderBottomColor: RULE,
    borderStyle: "solid",
    textAlign: "right",
    paddingBottom: 1,
  },

  // ── 供应商 / 收货地址, side by side ──
  blocks: { flexDirection: "row", marginTop: 14 },
  vendorBlock: { width: "42%", paddingRight: 12 },
  deliveryBlock: { width: "58%" },
  bar: {
    backgroundColor: NAVY,
    color: "#FFFFFF",
    fontWeight: 700,
    paddingVertical: 2,
    paddingHorizontal: 4,
    marginBottom: 4,
  },
  blockLine: { marginBottom: 2, lineHeight: 1.35 },

  // ── 订单资料 ──
  details: { marginTop: 12 },
  detailRow: { flexDirection: "row", marginBottom: 2 },
  detailLabel: { width: 62, fontWeight: 700 },

  // ── Table ──
  table: { marginTop: 12 },
  row: { flexDirection: "row" },
  headCell: {
    backgroundColor: NAVY,
    color: "#FFFFFF",
    fontWeight: 700,
    borderRightWidth: 0.75,
    borderBottomWidth: 0.75,
    borderColor: "#FFFFFF",
    borderStyle: "solid",
    paddingVertical: 3,
    paddingHorizontal: 3,
    lineHeight: 1.25,
  },
  cell: {
    borderRightWidth: 0.75,
    borderBottomWidth: 0.75,
    borderColor: RULE,
    borderStyle: "solid",
    paddingVertical: 4,
    paddingHorizontal: 3,
    lineHeight: 1.25,
  },
  firstCell: { borderLeftWidth: 0.75, borderLeftColor: RULE, borderStyle: "solid" },
  numeric: { textAlign: "right" },
  blackout: {
    color: NOTE_RED,
    fontWeight: 700,
    marginTop: 2,
  },
  sFoldRemark: {
    color: NOTE_RED,
    fontWeight: 700,
    marginTop: 1,
  },
  noteRow: {
    color: NOTE_RED,
    paddingVertical: 4,
    paddingHorizontal: 3,
    width: "100%",
  },

  // ── Footer ──
  footer: { marginTop: 16, width: "48%" },
  footerBar: {
    backgroundColor: GREY_BAR,
    fontWeight: 700,
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  footerBox: {
    borderWidth: 0.75,
    borderColor: RULE,
    borderStyle: "solid",
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  footerLine: { marginBottom: 3 },
});

// Column widths, in the samples' order. The fourth is the only column that
// differs between curtains and blinds.
const WIDTHS = ["13%", "12%", "16%", "15%", "11%", "11%", "22%"] as const;

// The last four columns are numbers or a short code and sit right-aligned in the
// samples; a column of decimals that does not line up is hard to scan against a
// cutting list.
const NUMERIC = [false, false, false, true, true, true, true] as const;

// Bilingual headers, Chinese above English, transcribed from the samples. The
// spacing inside the parentheses is theirs, not a typo of ours — the same
// half/full-width slip runs through the source spreadsheet.
const HEAD_CN = [
  "房间",
  "窗帘款式",
  "型号",
  null,
  "窗宽 ( 米）",
  "窗高 （米）",
  "开法",
];
const HEAD_EN = [
  "Room",
  "Type",
  "Fabric",
  null,
  "Width (M)",
  "Height (M)",
  "Opening",
];

const DERIVED_HEAD = {
  curtain: { cn: "面料米数 ( 米）", en: "Fabric Length (M)" },
  blind: { cn: "平方（米）", en: "SQM (M)" },
} as const;

function Table({ table, notes }: { table: PoTable; notes: string | null }) {
  const derived = DERIVED_HEAD[table.columnSet];

  return (
    <View style={styles.table}>
      {/* Repeated at the top of every page: a continuation sheet whose columns
          are unlabelled is a set of numbers with no units. */}
      <View style={styles.row} fixed>
        {WIDTHS.map((width, i) => (
          <View
            key={i}
            style={[
              styles.headCell,
              { width },
              NUMERIC[i] ? styles.numeric : {},
            ]}
          >
            <Text>{HEAD_CN[i] ?? derived.cn}</Text>
            <Text>{HEAD_EN[i] ?? derived.en}</Text>
          </View>
        ))}
      </View>

      {table.rows.map((row, i) => {
        const cells = [
          row.room,
          row.type,
          row.fabric,
          row.derived,
          row.widthM,
          row.heightM,
          row.opening,
        ];
        const orderRow = (
          <View style={styles.row} wrap={false}>
            {WIDTHS.map((width, c) => (
              <View
                key={c}
                style={[
                  styles.cell,
                  { width },
                  c === 0 ? styles.firstCell : {},
                  NUMERIC[c] ? styles.numeric : {},
                ]}
              >
                {c === 2 && row.blackout ? (
                  <>
                    <Text>{row.fabric}</Text>
                    <Text style={styles.blackout}>遮光 / BLACKOUT</Text>
                  </>
                ) : c === 6 && row.sFoldRemark ? (
                  <>
                    <Text>{row.opening}</Text>
                    {row.sFoldRemark ? (
                      <Text style={styles.sFoldRemark}>{row.sFoldRemark}</Text>
                    ) : null}
                  </>
                ) : (
                  <Text>{cells[c]}</Text>
                )}
              </View>
            ))}
          </View>
        );
        // A note is a cutting instruction for the rows above it. Keep it with
        // the final row so it can never become an orphan on a mostly empty page.
        return i === table.rows.length - 1 && notes ? (
          <View key={i} wrap={false}>
            {orderRow}
            <Text style={styles.noteRow}>{notes}</Text>
          </View>
        ) : (
          <View key={i}>{orderRow}</View>
        );
      })}

      {/* The Night sample's 都要绑带 sits under the table in red, because it is
          an instruction about the work in the rows above it. */}
      {notes && table.rows.length === 0 ? (
        <Text style={styles.noteRow}>{notes}</Text>
      ) : null}
    </View>
  );
}

export function PoDocument({ data }: { data: PoDocData }) {
  const { settings, vendor, delivery, orderDetails } = data;
  const clearance =
    orderDetails == null
      ? ""
      : // The samples print the 厘米 CM unit whether or not anybody has filled in
        // a number, so a null clearance leaves the unit standing alone.
        `${orderDetails.floorClearanceCm ?? ""} 厘米 CM`.trim();

  return (
    <Document title={`PO ${data.poNumber} — ${vendor.name}`}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>采购订单 (PO)</Text>

        <View style={styles.header}>
          <View style={styles.company}>
            <Text style={styles.companyName}>
              {settings.companyName} ({settings.companyUen})
            </Text>
            <Text style={styles.companyLine}>{settings.addressLine1}</Text>
            <Text style={styles.companyLine}>{settings.addressLine2}</Text>
            <Text style={styles.companyLine}>电话 : {settings.phone}</Text>
            <Text style={styles.companyLine}>微信 : {settings.wechat}</Text>
            <Text style={styles.companyLine}>网站 : {settings.website}</Text>
          </View>

          {/* No INVOICE REF row. The samples print the label, but the invoice
              is raised later and off-system, so ours could only ever print an
              empty ruled line — a blank that looks like a value nobody filled
              in. Dropped on the user's instruction, 2026-08-20. */}
          <View style={styles.refs}>
            <View style={styles.refRow}>
              <Text style={styles.refLabel}>PO TYPE</Text>
              <Text style={styles.refValue}>
                {data.category === "day" ? "DAY CURTAIN" : data.category === "night" ? "NIGHT CURTAIN" : "BLINDS"}
              </Text>
            </View>
            <View style={styles.refRow}>
              <Text style={styles.refLabel}>DATE</Text>
              <Text style={styles.refValue}>{data.dateLabel}</Text>
            </View>
            <View style={styles.refRow}>
              <Text style={styles.refLabel}>PO #</Text>
              <Text style={styles.refValue}>{data.poNumber}</Text>
            </View>
            <View style={styles.refRow}>
              <Text style={styles.refLabel}>CUST REF</Text>
              <Text style={styles.refValue}>{data.custRef ?? ""}</Text>
            </View>
          </View>
        </View>

        <View style={styles.blocks}>
          <View style={styles.vendorBlock}>
            <Text style={styles.bar}>供应商 Vendor</Text>
            {/* A missing detail OMITS its line rather than printing an empty
                one: the ZhuYingTai and Rising samples have no Chinese name and
                simply do not show that row. */}
            {vendor.nameCn ? (
              <Text style={styles.blockLine}>{vendor.nameCn}</Text>
            ) : null}
            <Text style={styles.blockLine}>{vendor.name}</Text>
            {vendor.addressCn ? (
              <Text style={styles.blockLine}>{vendor.addressCn}</Text>
            ) : null}
            {vendor.phone ? (
              <Text style={styles.blockLine}>电话： {vendor.phone}</Text>
            ) : null}
            {vendor.internalRef ? (
              <Text style={styles.blockLine}>
                Internal Ref: {vendor.internalRef}
              </Text>
            ) : null}
          </View>

          {/* Air freight only. 空运唛头 is an AIR shipping mark and the mark
              itself ends in 空; what a sea shipment carries instead is not in
              the samples, and a wrong mark on a crate is worse than none. */}
          {delivery ? (
            <View style={styles.deliveryBlock}>
              <Text style={styles.bar}>收货地址 Delivery Address</Text>
              {delivery.airShippingMark ? (
                <Text style={styles.blockLine}>
                  新加坡空运唛头： {delivery.airShippingMark}
                </Text>
              ) : null}
              {delivery.warehouseAddressCn ? (
                <Text style={styles.blockLine}>
                  仓库地址：{delivery.warehouseAddressCn}
                </Text>
              ) : null}
              {delivery.recipientCn ? (
                <Text style={styles.blockLine}>
                  收件人：{delivery.recipientCn}
                </Text>
              ) : null}
              {delivery.phone ? (
                <Text style={styles.blockLine}>电话： {delivery.phone}</Text>
              ) : null}
            </View>
          ) : null}
        </View>

        {/* 订单资料 is curtain-only, but the LABELS print either way: all four
            are on the Blinds sample with nothing after the colon. */}
        <View style={styles.details}>
          <Text style={styles.bar}>订单资料 Order Details</Text>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>窗帘款式：</Text>
            <Text>{orderDetails?.styleCn ?? ""}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>定型：</Text>
            <Text>{orderDetails?.heatSettingCn ?? ""}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>窗帘褶皱：</Text>
            <Text>{orderDetails?.fullnessLabel ?? ""}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>窗帘离地：</Text>
            <Text>{clearance}</Text>
          </View>
        </View>

        {data.tables.map((table, i) => (
          <Table
            key={table.columnSet}
            table={table}
            // The note belongs to the document, so it goes under the last table
            // — normally the only one.
            notes={i === data.tables.length - 1 ? data.notes : null}
          />
        ))}

        <View style={styles.footer}>
          <Text style={styles.footerBar}>备注</Text>
          <View style={styles.footerBox}>
            {/* 成品尺寸 = FINISHED sizes. This is the sentence that tells the
                vendor not to add their own allowance on top of ours, which is
                exactly what a frozen manufacturing measurement already is. */}
            <Text style={styles.footerLine}>
              以上是成品尺寸，等待供应商开单确认
            </Text>
            <Text style={styles.footerLine}>
              Wait for Vendor confirmation &amp; invoice
            </Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
