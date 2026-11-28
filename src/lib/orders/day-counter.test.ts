import { describe, expect, it } from "vitest";

import {
  earliestStatusEventAt,
  orderDayCounter,
  orderDayCounterLabel,
} from "@/lib/orders/day-counter";
import { addDays } from "@/lib/leads/sg-date";

const TODAY = "2026-11-28";
// SG noon on a given calendar date — toSgDate() of this instant is the date.
const on = (sgDate: string) => new Date(`${sgDate}T12:00:00+08:00`);
const daysAgo = (n: number) => on(addDays(TODAY, -n));

const label = (args: Parameters<typeof orderDayCounter>[0]) =>
  orderDayCounterLabel(orderDayCounter(args));

describe("orderDayCounter", () => {
  it("omits the counter when there is no milestone event", () => {
    expect(
      label({
        currentStatus: "deposit_received",
        depositReceivedAt: null,
        sentToVendorAt: null,
        today: TODAY,
      }),
    ).toBeNull();
    expect(
      label({
        currentStatus: "sent_to_vendor",
        depositReceivedAt: daysAgo(9),
        sentToVendorAt: null,
        today: TODAY,
      }),
    ).toBeNull();
  });

  it("counts days since payment while the order is awaiting dispatch", () => {
    expect(
      label({
        currentStatus: "deposit_received",
        depositReceivedAt: daysAgo(5),
        sentToVendorAt: null,
        today: TODAY,
      }),
    ).toBe("5 days since payment");
  });

  it("keeps the payment clock at po_ready — a generated PO is not sent", () => {
    expect(
      label({
        currentStatus: "po_ready",
        depositReceivedAt: daysAgo(7),
        sentToVendorAt: null,
        today: TODAY,
      }),
    ).toBe("7 days since payment");
  });

  it("switches to days since PO sent once dispatched", () => {
    expect(
      label({
        currentStatus: "sent_to_vendor",
        depositReceivedAt: daysAgo(20),
        sentToVendorAt: daysAgo(3),
        today: TODAY,
      }),
    ).toBe("3 days since PO sent");
  });

  it("retains the since-PO clock on a completed order", () => {
    expect(
      label({
        currentStatus: "completed",
        depositReceivedAt: daysAgo(60),
        sentToVendorAt: daysAgo(45),
        today: TODAY,
      }),
    ).toBe("45 days since PO sent");
  });

  it("hides the obsolete clock when current status reverts below the milestone", () => {
    expect(
      label({
        currentStatus: "quotation_sent",
        depositReceivedAt: daysAgo(10),
        sentToVendorAt: daysAgo(2),
        today: TODAY,
      }),
    ).toBeNull();
    expect(
      label({
        currentStatus: "order_recorded",
        depositReceivedAt: daysAgo(10),
        sentToVendorAt: null,
        today: TODAY,
      }),
    ).toBeNull();
  });

  it("supports day 0, singular day and plural days", () => {
    expect(
      label({
        currentStatus: "deposit_received",
        depositReceivedAt: on(TODAY),
        sentToVendorAt: null,
        today: TODAY,
      }),
    ).toBe("0 days since payment");
    expect(
      label({
        currentStatus: "deposit_received",
        depositReceivedAt: daysAgo(1),
        sentToVendorAt: null,
        today: TODAY,
      }),
    ).toBe("1 day since payment");
    expect(
      label({
        currentStatus: "sent_to_vendor",
        depositReceivedAt: daysAgo(30),
        sentToVendorAt: daysAgo(12),
        today: TODAY,
      }),
    ).toBe("12 days since PO sent");
  });

  it("counts Singapore calendar days at the UTC/SG midnight boundary", () => {
    // 2026-11-27 16:30 UTC is 2026-11-28 00:30 in Singapore — day 0.
    expect(
      label({
        currentStatus: "sent_to_vendor",
        depositReceivedAt: null,
        sentToVendorAt: new Date("2026-11-27T16:30:00.000Z"),
        today: TODAY,
      }),
    ).toBe("0 days since PO sent");
    // One hour earlier is still 2026-11-27 in Singapore — day 1.
    expect(
      label({
        currentStatus: "sent_to_vendor",
        depositReceivedAt: null,
        sentToVendorAt: new Date("2026-11-27T15:30:00.000Z"),
        today: TODAY,
      }),
    ).toBe("1 day since PO sent");
  });
});

describe("earliestStatusEventAt", () => {
  it("keeps the first event — a repeated same-status note does not reset the clock", () => {
    const events = [
      { status: "sent_to_vendor", created_at: "2026-11-26T03:00:00.000Z" },
      { status: "sent_to_vendor", created_at: "2026-11-10T03:00:00.000Z" },
      { status: "deposit_received", created_at: "2026-11-05T03:00:00.000Z" },
    ];
    expect(earliestStatusEventAt(events, "sent_to_vendor")).toEqual(
      new Date("2026-11-10T03:00:00.000Z"),
    );
    expect(earliestStatusEventAt(events, "po_ready")).toBeNull();
  });
});
