import { describe, expect, it } from "vitest";

import {
  containsChinese,
  poOpeningLabelSchema,
  poTypeLabelSchema,
  procurementSettingsSchema,
  roomTypeLabelSchema,
  seriesNameCnSchema,
  vendorProcurementFieldsSchema,
} from "./procurement";

const SERIES_ID = "3bca4fd9-50cc-4466-a817-eb93268c82b0";

const SETTINGS = {
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
  floorClearanceCm: "",
};

describe("procurementSettingsSchema", () => {
  it("accepts the seeded row unchanged", () => {
    const out = procurementSettingsSchema.parse(SETTINGS);
    expect(out.companyName).toBe("Drapeworks SG");
    expect(out.airShippingMark).toBe("BCH-SG-AD76-空 (写在包装）");
    expect(out.curtainStyleCn).toBe("韩式");
  });

  // The whole safety mechanism: NULL means "nobody has told us yet" and blocks
  // a PO. An empty string would look answered and print an empty cell.
  it("turns a blank optional field into null, never an empty string", () => {
    const out = procurementSettingsSchema.parse({
      ...SETTINGS,
      airShippingMark: "",
      warehouseAddressCn: "   ",
      recipientCn: undefined,
      deliveryPhone: null,
      curtainStyleCn: "\t\n",
    });
    expect(out.airShippingMark).toBeNull();
    expect(out.warehouseAddressCn).toBeNull();
    expect(out.recipientCn).toBeNull();
    expect(out.deliveryPhone).toBeNull();
    expect(out.curtainStyleCn).toBeNull();
  });

  it("trims the padding a paste leaves behind", () => {
    const out = procurementSettingsSchema.parse({
      ...SETTINGS,
      recipientCn: "  八戒-4207  ",
    });
    expect(out.recipientCn).toBe("八戒-4207");
  });

  it("requires the company block, which prints on every document", () => {
    expect(() =>
      procurementSettingsSchema.parse({ ...SETTINGS, companyName: "  " }),
    ).toThrow(/Company name/);
  });

  it("reads a floor clearance typed as a string", () => {
    const out = procurementSettingsSchema.parse({
      ...SETTINGS,
      floorClearanceCm: " 2 ",
    });
    expect(out.floorClearanceCm).toBe(2);
  });

  it("treats a blank floor clearance as not known", () => {
    expect(
      procurementSettingsSchema.parse({ ...SETTINGS, floorClearanceCm: "" })
        .floorClearanceCm,
    ).toBeNull();
    expect(
      procurementSettingsSchema.parse({ ...SETTINGS, floorClearanceCm: null })
        .floorClearanceCm,
    ).toBeNull();
  });

  it("rejects a fractional or out-of-range floor clearance", () => {
    expect(() =>
      procurementSettingsSchema.parse({ ...SETTINGS, floorClearanceCm: "1.5" }),
    ).toThrow(/whole number/);
    expect(() =>
      procurementSettingsSchema.parse({ ...SETTINGS, floorClearanceCm: "-1" }),
    ).toThrow(/between 0 and 100/);
    expect(() =>
      procurementSettingsSchema.parse({ ...SETTINGS, floorClearanceCm: "5000" }),
    ).toThrow(/between 0 and 100/);
  });

  it("rejects a floor clearance that is not a number at all", () => {
    expect(() =>
      procurementSettingsSchema.parse({ ...SETTINGS, floorClearanceCm: "low" }),
    ).toThrow();
  });
});

describe("roomTypeLabelSchema", () => {
  it("accepts a room type with a Chinese name and a code", () => {
    expect(
      roomTypeLabelSchema.parse({
        roomType: "Living Room",
        nameCn: " 客厅 ",
        code: " LR ",
      }),
    ).toEqual({ roomType: "Living Room", nameCn: "客厅", code: "LR" });
  });

  // Service Yard: the Blinds sample evidences the code SR and no Chinese at
  // all. Half-known is a legitimate state; inventing the other half is not.
  it("allows a known code with no Chinese name yet", () => {
    const out = roomTypeLabelSchema.parse({
      roomType: "Service Yard",
      nameCn: "",
      code: "SR",
    });
    expect(out.nameCn).toBeNull();
  });

  it("requires a code, because that is what having a row means", () => {
    expect(() =>
      roomTypeLabelSchema.parse({
        roomType: "Kitchen",
        nameCn: "厨房",
        code: "  ",
      }),
    ).toThrow(/code/i);
  });

  it("rejects a room type the enum does not have", () => {
    expect(() =>
      roomTypeLabelSchema.parse({
        roomType: "Attic",
        nameCn: "阁楼",
        code: "AT",
      }),
    ).toThrow();
  });
});

describe("poTypeLabelSchema", () => {
  it("accepts an evidenced label", () => {
    expect(
      poTypeLabelSchema.parse({ key: "night", labelCn: "窗帘 Night" }),
    ).toEqual({ key: "night", labelCn: "窗帘 Night" });
  });

  it("clears back to null rather than an empty string", () => {
    expect(poTypeLabelSchema.parse({ key: "blind", labelCn: "" }).labelCn)
      .toBeNull();
  });

  it("rejects a key outside the five coverings", () => {
    expect(() =>
      poTypeLabelSchema.parse({ key: "awning", labelCn: "雨篷" }),
    ).toThrow();
  });
});

describe("poOpeningLabelSchema", () => {
  it("accepts the evidenced double draw", () => {
    expect(
      poOpeningLabelSchema.parse({
        draw: "Double",
        labelCn: "对开 Double draw",
      }),
    ).toEqual({ draw: "Double", labelCn: "对开 Double draw" });
  });

  it("clears back to null", () => {
    expect(
      poOpeningLabelSchema.parse({ draw: "Single Left", labelCn: "  " })
        .labelCn,
    ).toBeNull();
  });

  it("requires a draw direction to key on", () => {
    expect(() =>
      poOpeningLabelSchema.parse({ draw: "", labelCn: "对开" }),
    ).toThrow();
  });
});

describe("seriesNameCnSchema", () => {
  it("accepts a series name in Chinese", () => {
    expect(
      seriesNameCnSchema.parse({ seriesId: SERIES_ID, nameCn: " 卷帘 " }),
    ).toEqual({ seriesId: SERIES_ID, nameCn: "卷帘" });
  });

  it("clears back to null", () => {
    expect(
      seriesNameCnSchema.parse({ seriesId: SERIES_ID, nameCn: "" }).nameCn,
    ).toBeNull();
  });

  it("rejects a series id that is not a uuid", () => {
    expect(() =>
      seriesNameCnSchema.parse({ seriesId: "roller", nameCn: "卷帘" }),
    ).toThrow();
  });
});

describe("vendorProcurementFieldsSchema", () => {
  it("trims all four and keeps them optional", () => {
    expect(
      vendorProcurementFieldsSchema.parse({
        internal_ref: " V006 ",
        name_cn: " 顺金纺织窗材有限公司 ",
        address_cn: " 北联 2 楼 2348 室 ",
        phone: " 13750954207 ",
      }),
    ).toEqual({
      internal_ref: "V006",
      name_cn: "顺金纺织窗材有限公司",
      address_cn: "北联 2 楼 2348 室",
      phone: "13750954207",
    });
  });

  it("stores a blank as null so the PO simply omits the line", () => {
    expect(vendorProcurementFieldsSchema.parse({})).toEqual({
      internal_ref: null,
      name_cn: null,
      address_cn: null,
      phone: null,
    });
    expect(
      vendorProcurementFieldsSchema.parse({
        internal_ref: "",
        name_cn: "   ",
        address_cn: null,
        phone: undefined,
      }),
    ).toEqual({
      internal_ref: null,
      name_cn: null,
      address_cn: null,
      phone: null,
    });
  });
});

describe("containsChinese", () => {
  // The screen uses this to flag a label that was filled in with English —
  // exactly what Service Yard's 'Service Yard' placeholder was before it was
  // nulled. It warns; it never blocks, because we cannot know every case.
  it("is true for Han characters, even mixed with Latin", () => {
    expect(containsChinese("客厅")).toBe(true);
    expect(containsChinese("窗帘 Night")).toBe(true);
    expect(containsChinese("BCH-SG-AD76-空")).toBe(true);
  });

  it("is false for a Latin-only string", () => {
    expect(containsChinese("Service Yard")).toBe(false);
    expect(containsChinese("LR")).toBe(false);
  });

  it("is false for nothing at all", () => {
    expect(containsChinese(null)).toBe(false);
    expect(containsChinese("")).toBe(false);
  });
});
