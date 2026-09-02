import { describe, expect, it } from "vitest";

import {
  fulfilmentArrangementCancellationSchema,
  fulfilmentArrangementSchema,
} from "./fulfilment";

const valid = {
  order_id: "550e8400-e29b-41d4-a716-446655440000",
  date: "2026-09-03",
  time: "10:30",
  duration_mins: 60,
  address: "957B Tampines St 96 #08-146",
};

describe("fulfilmentArrangementSchema", () => {
  it("accepts a valid Singapore installation slot", () => {
    expect(fulfilmentArrangementSchema.parse(valid)).toEqual(valid);
  });

  it.each(["2026-02-29", "2026-13-01", "2026-09-31"])(
    "rejects impossible calendar date %s",
    (date) => {
      expect(() => fulfilmentArrangementSchema.parse({ ...valid, date })).toThrow();
    },
  );

  it.each(["24:00", "12:60", "99:99"])("rejects invalid clock time %s", (time) => {
    expect(() => fulfilmentArrangementSchema.parse({ ...valid, time })).toThrow();
  });

  it("requires an address and bounds the duration", () => {
    expect(() =>
      fulfilmentArrangementSchema.parse({ ...valid, address: "" }),
    ).toThrow();
    expect(() =>
      fulfilmentArrangementSchema.parse({ ...valid, duration_mins: 10 }),
    ).toThrow();
  });
});

describe("fulfilmentArrangementCancellationSchema", () => {
  it("requires an audited cancellation reason", () => {
    expect(() =>
      fulfilmentArrangementCancellationSchema.parse({
        order_id: valid.order_id,
        reason: "   ",
      }),
    ).toThrow("Cancellation reason is required");
  });
});
