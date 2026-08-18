import { describe, expect, it } from "vitest";

import {
  buildPos,
  cmToM,
  fabricLengthM,
  formatPoDate,
  fullnessLabel,
  roomLabel,
  sqmM,
  type PoInput,
  type PoLine,
  type PoRoomLabel,
  type PoSettings,
  type PoVendor,
} from "./build";

// Every number in this file comes off one of the three sample purchase orders in
// resource/documents/ (Omar, Tampines 957B). They are the only specification the
// factory-facing arithmetic has, so a failure here should read as "the document
// changed", not "a helper changed".

const SETTINGS: PoSettings = {
  companyName: "Drapeworks SG",
  companyUen: "UEN202609289G",
  addressLine1: "60 Paya Lebar Road # 06-28",
  addressLine2: "Singapore 409051",
  phone: "+65 8513 3236",
  wechat: "130 6177 3305",
  website: "http://www.drapeworks.sg",
  airShippingMark: "BCH-SG-AD76-空 (写在包装）",
  warehouseAddressCn: "广东省深圳市宝安区福洲大道同富路科聚通工业园D栋1楼102",
  recipientCn: "八戒-4207",
  deliveryPhone: "13750954207",
  curtainStyleCn: "韩式",
  heatSettingCn: "高温定型",
  floorClearanceCm: null,
};

const RISING: PoVendor = {
  id: "v-rising",
  name: "Rising",
  nameCn: null,
  addressCn: "北联 2 楼 2358 室",
  phone: "13750954207",
  internalRef: "V005",
};

const ZHUYINGTAI: PoVendor = {
  id: "v-zyt",
  name: "ZhuYingTai",
  nameCn: null,
  addressCn: "北联 2 楼 2348 室",
  phone: "13750954207",
  internalRef: "V006",
};

const SHUNJIN: PoVendor = {
  id: "v-shunjin",
  name: "ShunJin Textile Pte Ltd",
  nameCn: "顺金纺织窗材有限公司",
  addressCn: null,
  phone: "13750954207",
  internalRef: "V007",
};

// The four rows the seed migration loads — EXCEPT that Service Yard's name_cn
// is NULL in the database. The Blinds sample prints `SR Service Yard` with no
// Hanzi anywhere in the cell, so its Chinese is genuinely unknown to us.
//
// The placeholder below stands in for the name the business will supply, so
// that the rest of the Blinds sample — the 平方 column, the blank 订单资料 —
// can still be exercised here. IT IS A TEST FIXTURE, NOT A TRANSLATION: what
// the real NULL does is asserted in "buildPos — labels we do not have".
const LABELS = new Map<string, PoRoomLabel>([
  ["Living Room", { nameCn: "客厅", code: "LR" }],
  ["Master Bedroom", { nameCn: "主卧", code: "MB" }],
  ["Bedroom", { nameCn: "次卧", code: "BR" }],
  ["Service Yard", { nameCn: "(name pending)", code: "SR" }],
]);

function line(over: Partial<PoLine> & Pick<PoLine, "lineId">): PoLine {
  return {
    vendorId: RISING.id,
    roomId: `room-${over.lineId}`,
    roomLabel: "Living Room",
    roomType: "Living Room",
    roomPosition: 0,
    position: 0,
    kind: "curtain",
    typeLabel: "窗帘 Night",
    fabricLabel: "清风麻 -2",
    openingLabel: "对开 Double draw",
    mfgWidthCm: 274,
    mfgHeightCm: 255,
    ...over,
  };
}

function input(over: Partial<PoInput> = {}): PoInput {
  return {
    settings: SETTINGS,
    poNumber: "10040",
    custRef: "Omar Tampines 957B 08-146",
    invoiceRef: null,
    generatedAt: new Date("2026-08-08T02:00:00Z"),
    freightMode: "air",
    fullnessBps: 20000,
    vendors: [RISING, ZHUYINGTAI, SHUNJIN],
    roomLabels: LABELS,
    lines: [],
    ...over,
  };
}

describe("cmToM", () => {
  it("prints centimetres as metres to two decimal places", () => {
    expect(cmToM(274)).toBe("2.74");
    expect(cmToM(255)).toBe("2.55");
    expect(cmToM(120)).toBe("1.20");
  });

  it("pads to two decimals rather than trimming a trailing zero", () => {
    // "2.5" beside a column of "2.74"s reads as a different precision, and on a
    // cutting instruction that invites a question.
    expect(cmToM(250)).toBe("2.50");
    expect(cmToM(300)).toBe("3.00");
  });

  it("keeps sub-metre widths in the same shape", () => {
    expect(cmToM(85)).toBe("0.85");
    expect(cmToM(5)).toBe("0.05");
  });
});

describe("fabricLengthM", () => {
  it("reproduces every row of the Night sample at 2.0 fullness", () => {
    expect(fabricLengthM(274, 20000)).toBe("5.48");
    expect(fabricLengthM(302, 20000)).toBe("6.04");
    expect(fabricLengthM(255, 20000)).toBe("5.10");
    expect(fabricLengthM(249, 20000)).toBe("4.98");
  });

  it("derives from centimetres and rounds once at the end", () => {
    // 2.67 m × 2.5 is 6.675 exactly, but the float nearest 2.67 is a shade
    // under, so multiplying the METRES gives 6.67. Working in centimetres —
    // 267 × 25000 / 10000 = 667.5 hundredths — gives 6.68.
    expect((2.67 * 2.5).toFixed(2)).toBe("6.67");
    expect(fabricLengthM(267, 25000)).toBe("6.68");
  });

  it("handles a fullness that is not a whole number", () => {
    expect(fabricLengthM(200, 15000)).toBe("3.00");
  });
});

describe("sqmM", () => {
  it("reproduces the Blinds sample", () => {
    expect(sqmM(205, 120)).toBe("2.46");
  });

  it("derives the area from centimetres and rounds once at the end", () => {
    // Same trap as fabric length: 2.67 × 2.50 in metres rounds down to 6.67.
    expect((2.67 * 2.5).toFixed(2)).toBe("6.67");
    expect(sqmM(267, 250)).toBe("6.68");
  });
});

describe("roomLabel", () => {
  it("prints the Chinese name then the code when a type appears once", () => {
    // The samples show a bare 客厅 LR, never LR1.
    expect(roomLabel("客厅", "LR", null)).toBe("客厅 LR");
    expect(roomLabel("主卧", "MB", null)).toBe("主卧 MB");
  });

  it("numbers both halves when a type repeats", () => {
    expect(roomLabel("次卧", "BR", 1)).toBe("次卧 1 BR1");
    expect(roomLabel("次卧", "BR", 2)).toBe("次卧 2 BR2");
  });
});

describe("fullnessLabel", () => {
  it("prints basis points as the samples' 倍", () => {
    expect(fullnessLabel(20000)).toBe("2 倍");
    expect(fullnessLabel(25000)).toBe("2.5 倍");
  });
});

describe("formatPoDate", () => {
  it("formats the way the samples do", () => {
    expect(formatPoDate(new Date("2026-08-08T02:00:00Z"))).toBe("08 August 2026");
  });
});

describe("buildPos — the Night sample end to end", () => {
  const nightLines: PoLine[] = [
    line({
      lineId: "w1",
      roomId: "r1",
      roomType: "Living Room",
      roomPosition: 0,
      mfgWidthCm: 274,
      mfgHeightCm: 255,
    }),
    line({
      lineId: "w2",
      roomId: "r2",
      roomType: "Master Bedroom",
      roomPosition: 1,
      mfgWidthCm: 302,
      mfgHeightCm: 255,
    }),
    line({
      lineId: "w3",
      roomId: "r3",
      roomType: "Bedroom",
      roomPosition: 2,
      mfgWidthCm: 255,
      mfgHeightCm: 256,
    }),
    line({
      lineId: "w4",
      roomId: "r4",
      roomType: "Bedroom",
      roomPosition: 3,
      mfgWidthCm: 249,
      mfgHeightCm: 254,
    }),
  ];

  it("reproduces the table exactly", () => {
    const { pos, problems } = buildPos(input({ lines: nightLines }));

    expect(problems).toEqual([]);
    expect(pos).toHaveLength(1);
    expect(pos[0].tables).toHaveLength(1);
    expect(pos[0].tables[0].columnSet).toBe("curtain");
    expect(pos[0].tables[0].rows).toEqual([
      {
        room: "客厅 LR",
        type: "窗帘 Night",
        fabric: "清风麻 -2",
        derived: "5.48",
        widthM: "2.74",
        heightM: "2.55",
        opening: "对开 Double draw",
      },
      {
        room: "主卧 MB",
        type: "窗帘 Night",
        fabric: "清风麻 -2",
        derived: "6.04",
        widthM: "3.02",
        heightM: "2.55",
        opening: "对开 Double draw",
      },
      {
        room: "次卧 1 BR1",
        type: "窗帘 Night",
        fabric: "清风麻 -2",
        derived: "5.10",
        widthM: "2.55",
        heightM: "2.56",
        opening: "对开 Double draw",
      },
      {
        room: "次卧 2 BR2",
        type: "窗帘 Night",
        fabric: "清风麻 -2",
        derived: "4.98",
        widthM: "2.49",
        heightM: "2.54",
        opening: "对开 Double draw",
      },
    ]);
  });

  it("carries the header the samples print", () => {
    const { pos } = buildPos(input({ lines: nightLines }));

    expect(pos[0].poNumber).toBe("10040");
    expect(pos[0].dateLabel).toBe("08 August 2026");
    expect(pos[0].custRef).toBe("Omar Tampines 957B 08-146");
    expect(pos[0].vendor.name).toBe("Rising");
    expect(pos[0].vendor.internalRef).toBe("V005");
  });

  it("fills the curtain-only order details", () => {
    const { pos } = buildPos(input({ lines: nightLines }));

    expect(pos[0].orderDetails).toEqual({
      styleCn: "韩式",
      heatSettingCn: "高温定型",
      fullnessLabel: "2 倍",
      floorClearanceCm: null,
    });
  });
});

describe("buildPos — the Blinds sample", () => {
  const blindLine = line({
    lineId: "w9",
    vendorId: SHUNJIN.id,
    roomId: "r9",
    roomLabel: "Service Yard",
    roomType: "Service Yard",
    roomPosition: 0,
    kind: "blind",
    typeLabel: "卷帘",
    fabricLabel: "1079-13",
    openingLabel: "要罩盒 - with cover",
    mfgWidthCm: 205,
    mfgHeightCm: 120,
  });

  it("swaps the fourth column for square metres", () => {
    const { pos, problems } = buildPos(input({ lines: [blindLine] }));

    expect(problems).toEqual([]);
    expect(pos[0].tables[0].columnSet).toBe("blind");
    expect(pos[0].tables[0].rows[0]).toEqual({
      // See LABELS: the Chinese for a service yard is unknown, so the fixture
      // supplies a stand-in. The sample's own cell reads `SR Service Yard`.
      room: "(name pending) SR",
      type: "卷帘",
      fabric: "1079-13",
      derived: "2.46",
      widthM: "2.05",
      heightM: "1.20",
      opening: "要罩盒 - with cover",
    });
  });

  it("leaves the curtain-only order details unfilled", () => {
    const { pos } = buildPos(input({ lines: [blindLine] }));

    expect(pos[0].orderDetails).toBeNull();
  });
});

describe("buildPos — vendor grouping", () => {
  it("puts two lines sharing a vendor on ONE document", () => {
    const { pos } = buildPos(
      input({
        lines: [
          line({ lineId: "a", roomId: "r1", roomPosition: 0 }),
          line({
            lineId: "b",
            roomId: "r2",
            roomType: "Master Bedroom",
            roomPosition: 1,
          }),
        ],
      }),
    );

    expect(pos).toHaveLength(1);
    expect(pos[0].tables[0].rows).toHaveLength(2);
  });

  it("splits by vendor, not by product type", () => {
    // The Omar order's day and night curtains are the same window; they went to
    // different vendors, which is the only reason they are two documents.
    const { pos } = buildPos(
      input({
        lines: [
          line({ lineId: "day", vendorId: ZHUYINGTAI.id, typeLabel: "纱窗 Day" }),
          line({ lineId: "night", vendorId: RISING.id }),
          line({
            lineId: "blind",
            vendorId: SHUNJIN.id,
            kind: "blind",
            roomType: "Service Yard",
            roomId: "r9",
            roomPosition: 1,
          }),
        ],
      }),
    );

    expect(pos).toHaveLength(3);
    expect(pos.map((p) => p.vendor.name)).toEqual([
      "ZhuYingTai",
      "Rising",
      "ShunJin Textile Pte Ltd",
    ]);
  });

  it("reports a line whose series has no vendor instead of dropping it", () => {
    const { pos, problems } = buildPos(
      input({
        lines: [
          line({ lineId: "ok" }),
          line({
            lineId: "orphan",
            vendorId: null,
            roomLabel: "Study",
            roomType: "Master Bedroom",
            roomId: "r2",
            roomPosition: 1,
            position: 1,
          }),
        ],
      }),
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("Study");
    expect(problems[0]).toContain("Window 2");
    // The good line still previews; nothing is quietly manufactured.
    expect(pos).toHaveLength(1);
    expect(pos[0].tables[0].rows).toHaveLength(1);
  });

  it("reports a vendor id that has no vendor row", () => {
    const { pos, problems } = buildPos(
      input({ lines: [line({ lineId: "a", vendorId: "v-missing" })] }),
    );

    expect(problems).toHaveLength(1);
    expect(pos).toEqual([]);
  });
});

describe("buildPos — room numbering", () => {
  it("numbers repeated room types by room position", () => {
    const { pos } = buildPos(
      input({
        lines: [
          // Deliberately out of order: position, not array order, decides.
          line({
            lineId: "b",
            roomId: "r-second",
            roomType: "Bedroom",
            roomPosition: 5,
          }),
          line({
            lineId: "a",
            roomId: "r-first",
            roomType: "Bedroom",
            roomPosition: 2,
          }),
        ],
      }),
    );

    expect(pos[0].tables[0].rows.map((r) => r.room)).toEqual([
      "次卧 1 BR1",
      "次卧 2 BR2",
    ]);
  });

  it("does not number a room type that appears once", () => {
    const { pos } = buildPos(input({ lines: [line({ lineId: "a" })] }));

    expect(pos[0].tables[0].rows[0].room).toBe("客厅 LR");
  });

  it("gives two windows in the same room the same label", () => {
    const { pos } = buildPos(
      input({
        lines: [
          line({ lineId: "a", roomId: "r1", roomType: "Bedroom", position: 0 }),
          line({ lineId: "b", roomId: "r1", roomType: "Bedroom", position: 1 }),
        ],
      }),
    );

    expect(pos[0].tables[0].rows.map((r) => r.room)).toEqual([
      "次卧 BR",
      "次卧 BR",
    ]);
  });

  it("reports an unlabelled room type by name rather than rendering it blank", () => {
    const { pos, problems } = buildPos(
      input({ lines: [line({ lineId: "a", roomType: "Study Room" })] }),
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("Study Room");
    expect(pos).toEqual([]);
  });

  it("reports each unlabelled room type once, however many windows it has", () => {
    const { problems } = buildPos(
      input({
        lines: [
          line({ lineId: "a", roomType: "Kitchen", roomId: "r1" }),
          line({ lineId: "b", roomType: "Kitchen", roomId: "r2" }),
        ],
      }),
    );

    expect(problems).toHaveLength(1);
  });
});

describe("buildPos — labels we do not have", () => {
  // The rule this block enforces: a cell we cannot fill BLOCKS the document.
  //
  // These are cutting instructions. A blank 窗帘款式 does not tell a factory
  // "no style", it tells them nothing, and somebody in Shenzhen then guesses —
  // which is the failure this whole phase exists to remove. Only three of these
  // labels are evidenced by the samples (纱窗 Day, 窗帘 Night, 对开 Double
  // draw); every other one is NULL in the database, waiting for the business,
  // and until it arrives the honest output is a refusal naming the gap.

  it("reports a room type whose label row carries no Chinese name", () => {
    // Service Yard's real state. The row EXISTS — the code SR is evidenced by
    // the Blinds sample — but name_cn is NULL, so the row-absence check that
    // catches Kitchen and Balcony cannot catch this one.
    const { pos, problems } = buildPos(
      input({
        roomLabels: new Map<string, PoRoomLabel>([
          ["Service Yard", { nameCn: null, code: "SR" }],
        ]),
        lines: [
          line({ lineId: "a", roomType: "Service Yard", kind: "blind" }),
        ],
      }),
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("Service Yard");
    expect(pos).toEqual([]);
  });

  it("reports a line with no 窗帘款式 label instead of printing an empty cell", () => {
    const { pos, problems } = buildPos(
      input({ lines: [line({ lineId: "a", typeLabel: null })] }),
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("窗帘款式");
    expect(pos).toEqual([]);
  });

  it("reports a line with no 开法 label instead of printing an empty cell", () => {
    const { pos, problems } = buildPos(
      input({ lines: [line({ lineId: "a", openingLabel: null })] }),
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("开法");
    expect(pos).toEqual([]);
  });

  it("names the window each missing label belongs to", () => {
    // Both gaps are reported, not just the first: whoever is fixing this should
    // see everything wrong with the window in one pass, and the room label and
    // window number are how they find it on the screen.
    const { problems } = buildPos(
      input({
        lines: [
          line({ lineId: "ok", roomId: "r1" }),
          line({
            lineId: "bad",
            roomId: "r2",
            roomLabel: "Kids room",
            roomType: "Master Bedroom",
            roomPosition: 1,
            position: 2,
            typeLabel: null,
            openingLabel: null,
          }),
        ],
      }),
    );

    expect(problems).toHaveLength(2);
    for (const problem of problems) {
      expect(problem).toContain("Kids room");
      expect(problem).toContain("Window 3");
    }
  });

  it("keeps the good lines previewable beside the problem", () => {
    const { pos, problems } = buildPos(
      input({
        lines: [
          line({ lineId: "ok", roomId: "r1" }),
          line({
            lineId: "bad",
            roomId: "r2",
            roomType: "Master Bedroom",
            roomPosition: 1,
            typeLabel: null,
          }),
        ],
      }),
    );

    expect(problems).toHaveLength(1);
    expect(pos).toHaveLength(1);
    expect(pos[0].tables[0].rows).toHaveLength(1);
  });

  it("returns no problems when every label is present", () => {
    const { pos, problems } = buildPos(input({ lines: [line({ lineId: "a" })] }));

    expect(problems).toEqual([]);
    expect(pos[0].tables[0].rows[0].type).toBe("窗帘 Night");
    expect(pos[0].tables[0].rows[0].opening).toBe("对开 Double draw");
  });
});

describe("buildPos — freight and missing vendor details", () => {
  it("carries the air delivery block when the order flies", () => {
    const { pos } = buildPos(input({ lines: [line({ lineId: "a" })] }));

    expect(pos[0].delivery).toEqual({
      airShippingMark: "BCH-SG-AD76-空 (写在包装）",
      warehouseAddressCn:
        "广东省深圳市宝安区福洲大道同富路科聚通工业园D栋1楼102",
      recipientCn: "八戒-4207",
      phone: "13750954207",
    });
  });

  it("omits the delivery block on a sea order", () => {
    // 空运唛头 is an AIR shipping mark. What replaces it at sea is unknown, and
    // a wrong shipping mark is worse than none.
    const { pos } = buildPos(
      input({ lines: [line({ lineId: "a" })], freightMode: "sea" }),
    );

    expect(pos[0].delivery).toBeNull();
  });

  it("still builds a document for a vendor with no contact details", () => {
    const bare: PoVendor = {
      id: "v-bare",
      name: "Unknown Factory",
      nameCn: null,
      addressCn: null,
      phone: null,
      internalRef: null,
    };
    const { pos, problems } = buildPos(
      input({
        vendors: [bare],
        lines: [line({ lineId: "a", vendorId: bare.id })],
      }),
    );

    expect(problems).toEqual([]);
    expect(pos[0].vendor).toEqual(bare);
    expect(pos[0].tables[0].rows).toHaveLength(1);
  });
});

describe("buildPos — a vendor supplying both curtains and blinds", () => {
  it("keeps the two column sets in separate tables", () => {
    // Not in the samples, but curtain_series.vendor_id permits it. The fourth
    // column means different things, so one header cannot serve both.
    const { pos } = buildPos(
      input({
        lines: [
          line({ lineId: "c", roomId: "r1" }),
          line({
            lineId: "b",
            kind: "blind",
            roomId: "r2",
            roomType: "Service Yard",
            roomPosition: 1,
            mfgWidthCm: 205,
            mfgHeightCm: 120,
          }),
        ],
      }),
    );

    expect(pos).toHaveLength(1);
    expect(pos[0].tables.map((t) => t.columnSet)).toEqual(["curtain", "blind"]);
    expect(pos[0].tables[1].rows[0].derived).toBe("2.46");
    // Curtains are on the document, so the curtain-only block is filled.
    expect(pos[0].orderDetails).not.toBeNull();
  });
});

describe("buildPos — notes", () => {
  it("attaches the per-vendor note the Night sample carries", () => {
    const { pos } = buildPos(
      input({
        lines: [line({ lineId: "a" })],
        notesByVendorId: new Map([[RISING.id, "都要绑带"]]),
      }),
    );

    expect(pos[0].notes).toBe("都要绑带");
  });

  it("leaves the note null when there is none", () => {
    const { pos } = buildPos(input({ lines: [line({ lineId: "a" })] }));

    expect(pos[0].notes).toBeNull();
  });
});
