import { describe, expect, it } from "vitest";

import { allowanceSchema, confirmManufactureSchema } from "./manufacture";

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const LINE_ID = "22222222-2222-4222-8222-222222222222";

describe("allowanceSchema", () => {
  it("accepts a negative delta pair", () => {
    expect(
      allowanceSchema.parse({
        productLine: "curtain",
        widthDeltaCm: -2,
        heightDeltaCm: -4,
      }),
    ).toEqual({ productLine: "curtain", widthDeltaCm: -2, heightDeltaCm: -4 });
  });

  it("accepts zero", () => {
    const out = allowanceSchema.parse({
      productLine: "mesh",
      widthDeltaCm: 0,
      heightDeltaCm: 0,
    });
    expect(out.widthDeltaCm).toBe(0);
  });

  it("accepts a positive delta, since the sign is meaningful", () => {
    const out = allowanceSchema.parse({
      productLine: "blind",
      widthDeltaCm: 1,
      heightDeltaCm: 2,
    });
    expect(out.widthDeltaCm).toBe(1);
  });

  it("rejects an unknown product line", () => {
    expect(() =>
      allowanceSchema.parse({
        productLine: "awning",
        widthDeltaCm: 0,
        heightDeltaCm: 0,
      }),
    ).toThrow();
  });

  it("rejects a non-integer delta", () => {
    expect(() =>
      allowanceSchema.parse({
        productLine: "curtain",
        widthDeltaCm: -2.5,
        heightDeltaCm: -4,
      }),
    ).toThrow();
  });

  // The bound is inclusive. Pinning both sides of it means an off-by-one —
  // ±99 or ±101 — fails here rather than at a vendor's cutting table.
  it("accepts a delta exactly on the bound", () => {
    expect(
      allowanceSchema.parse({
        productLine: "curtain",
        widthDeltaCm: -100,
        heightDeltaCm: 100,
      }).widthDeltaCm,
    ).toBe(-100);
  });

  it("rejects a delta one past the bound", () => {
    expect(() =>
      allowanceSchema.parse({
        productLine: "curtain",
        widthDeltaCm: -101,
        heightDeltaCm: 0,
      }),
    ).toThrow();
    expect(() =>
      allowanceSchema.parse({
        productLine: "curtain",
        widthDeltaCm: 0,
        heightDeltaCm: 101,
      }),
    ).toThrow();
  });

  it("rejects an implausibly large delta", () => {
    expect(() =>
      allowanceSchema.parse({
        productLine: "curtain",
        widthDeltaCm: -500,
        heightDeltaCm: -4,
      }),
    ).toThrow();
  });
});

describe("confirmManufactureSchema", () => {
  it("accepts an order with one un-overridden line", () => {
    const out = confirmManufactureSchema.parse({
      orderId: ORDER_ID,
      lines: [{ lineId: LINE_ID, kind: "window" }],
    });
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0].lineId).toBe(LINE_ID);
  });

  it("accepts an override carrying a width, a height and a reason", () => {
    const out = confirmManufactureSchema.parse({
      orderId: ORDER_ID,
      lines: [
        {
          lineId: LINE_ID,
          kind: "mesh_panel",
          overrideWidthCm: 150,
          overrideHeightCm: 240,
          overrideReason: "Bay window, vendor confirmed by phone",
        },
      ],
    });
    expect(out.lines[0].overrideWidthCm).toBe(150);
    expect(out.lines[0].overrideHeightCm).toBe(240);
  });

  // The reason is the whole audit trail for a hand-edited dimension. Without
  // it nobody can tell a deliberate adjustment from a typo.
  // The reason stopped being mandatory once the allowance became editable per
  // line: every manufacturing figure is reachable by adjusting a delta, so
  // demanding a why on one route and not the other bought nothing.
  it("accepts an override with no reason", () => {
    const out = confirmManufactureSchema.parse({
      orderId: ORDER_ID,
      lines: [{ lineId: LINE_ID, kind: "window", overrideWidthCm: 150 }],
    });
    expect(out.lines[0].overrideWidthCm).toBe(150);
    expect(out.lines[0].overrideReason).toBeUndefined();
  });

  it("trims a whitespace-only reason to an empty string rather than refusing", () => {
    const out = confirmManufactureSchema.parse({
      orderId: ORDER_ID,
      lines: [
        {
          lineId: LINE_ID,
          kind: "window",
          overrideHeightCm: 240,
          overrideReason: "   ",
        },
      ],
    });
    expect(out.lines[0].overrideHeightCm).toBe(240);
    expect(out.lines[0].overrideReason).toBe("");
  });

  it("rejects a non-uuid order id", () => {
    expect(() =>
      confirmManufactureSchema.parse({
        orderId: "order-7",
        lines: [{ lineId: LINE_ID, kind: "window" }],
      }),
    ).toThrow();
  });

  // Confirming nothing would advance the order to sent_to_vendor with no
  // measurements behind it.
  it("rejects an empty lines array", () => {
    expect(() =>
      confirmManufactureSchema.parse({ orderId: ORDER_ID, lines: [] }),
    ).toThrow();
  });

  it("rejects a fractional override dimension", () => {
    expect(() =>
      confirmManufactureSchema.parse({
        orderId: ORDER_ID,
        lines: [
          {
            lineId: LINE_ID,
            kind: "window",
            overrideWidthCm: 150.5,
            overrideReason: "measured again",
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects a zero or negative override dimension", () => {
    for (const overrideWidthCm of [0, -10]) {
      expect(() =>
        confirmManufactureSchema.parse({
          orderId: ORDER_ID,
          lines: [
            {
              lineId: LINE_ID,
              kind: "window",
              overrideWidthCm,
              overrideReason: "measured again",
            },
          ],
        }),
      ).toThrow();
    }
  });

  it("rejects an unknown line kind", () => {
    expect(() =>
      confirmManufactureSchema.parse({
        orderId: ORDER_ID,
        lines: [{ lineId: LINE_ID, kind: "door" }],
      }),
    ).toThrow();
  });
});
