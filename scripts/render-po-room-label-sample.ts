// Local-only sample render for the preserved-bedroom-label fix.
//
// Reproduces the reported bug fixture — Bedroom 2 saved before Bedroom 1 —
// through the production buildPos + renderPo path, with no database, network,
// or environment. Prints a JSON diagnostic mapping each saved room label to
// the room code the document prints beside its own frozen dimensions, then
// writes the PDF for Codex to inspect.
//
//   node --import tsx scripts/render-po-room-label-sample.ts [out.pdf]
//
// Default output: /private/tmp/po-room-label-task/sample.pdf

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { buildPos, type PoInput } from "../src/lib/po/build";
import { renderPo } from "../src/lib/po/render";

const OUT = process.argv[2] ?? "/private/tmp/po-room-label-task/sample.pdf";

const input: PoInput = {
  settings: {
    companyName: "Drapeworks SG",
    companyUen: "UEN202609289G",
    addressLine1: "60 Paya Lebar Road # 06-28",
    addressLine2: "Singapore 409051",
    phone: "+65 8513 3236",
    wechat: "130 6177 3305",
    website: "http://www.drapeworks.sg",
    curtainStyleCn: "韩式",
    heatSettingCn: "高温定型",
    floorClearanceCm: null,
  },
  poNumber: "QA-LABELS",
  custRef: "Saved bedroom labels sample",
  generatedAt: new Date("2026-11-12T02:00:00Z"),
  freightMode: "sea",
  delivery: null,
  fullnessBps: 20000,
  vendors: [
    {
      id: "v-qa",
      name: "QA Vendor",
      nameCn: null,
      addressCn: "北联 2 楼 2358 室",
      phone: "13750954207",
      internalRef: "QA001",
    },
  ],
  roomLabels: new Map([
    ["Bedroom", { nameCn: "次卧", code: "BR" }],
    ["Living Room", { nameCn: "客厅", code: "LR" }],
  ]),
  // The bug fixture: Bedroom 2 was saved at position 0, Bedroom 1 after it.
  // The document must keep each label's own number and dimensions.
  rooms: [
    { id: "lr", type: "Living Room", position: 2, label: "Living Room" },
    { id: "br2", type: "Bedroom", position: 0, label: "Bedroom 2" },
    { id: "br1", type: "Bedroom", position: 1, label: "Bedroom 1" },
  ],
  lines: [
    {
      lineId: "br2:w1", vendorId: "v-qa", roomId: "br2", roomLabel: "Bedroom 2",
      roomType: "Bedroom", roomPosition: 0, position: 0,
      kind: "curtain", category: "night",
      typeLabel: "窗帘 Night", fabricLabel: "清风麻 -2",
      blackout: false, sFold: false, sideInstallation: false,
      draw: "Double", openingLabel: "对开 Double draw",
      mfgWidthCm: 222, mfgHeightCm: 255,
    },
    {
      lineId: "br1:w1", vendorId: "v-qa", roomId: "br1", roomLabel: "Bedroom 1",
      roomType: "Bedroom", roomPosition: 1, position: 0,
      kind: "curtain", category: "night",
      typeLabel: "窗帘 Night", fabricLabel: "清风麻 -2",
      blackout: false, sFold: false, sideInstallation: false,
      draw: "Double", openingLabel: "对开 Double draw",
      mfgWidthCm: 111, mfgHeightCm: 255,
    },
    {
      lineId: "lr:w1", vendorId: "v-qa", roomId: "lr", roomLabel: "Living Room",
      roomType: "Living Room", roomPosition: 2, position: 0,
      kind: "curtain", category: "night",
      typeLabel: "窗帘 Night", fabricLabel: "清风麻 -2",
      blackout: false, sFold: false, sideInstallation: false,
      draw: "Double", openingLabel: "对开 Double draw",
      mfgWidthCm: 274, mfgHeightCm: 255,
    },
  ],
};

async function main(): Promise<void> {
  const { pos, problems } = buildPos(input);

  const diagnostic = {
    problems,
    rooms: input.rooms.map((r) => ({ id: r.id, label: r.label, position: r.position })),
    documents: pos.map((po) => ({
      vendor: po.vendor.name,
      category: po.category,
      rows: po.tables.flatMap((t) =>
        t.rows.map((row) => ({
          printedRoom: row.room,
          widthM: row.widthM,
          heightM: row.heightM,
          derived: row.derived,
          fabric: row.fabric,
        })),
      ),
    })),
  };
  console.log(JSON.stringify(diagnostic, null, 2));

  if (problems.length > 0 || pos.length === 0) {
    console.error("buildPos reported problems; not rendering.");
    process.exit(1);
  }

  mkdirSync(dirname(OUT), { recursive: true });
  for (const [i, doc] of pos.entries()) {
    const path = pos.length === 1 ? OUT : OUT.replace(/\.pdf$/, `-${i + 1}.pdf`);
    writeFileSync(path, await renderPo(doc));
    console.error(`wrote ${path}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
