import { describe, expect, it } from "vitest";

import {
  ACTIVE_ORDER_STATUSES,
  AWAITING_BALANCE_STATUSES,
  AWAITING_SHIPMENT_STATUSES,
  DEFAULT_ORDER_LIST_STATUSES,
  IN_PRODUCTION_STATUSES,
  READY_FOR_INSTALLATION_STATUSES,
} from "./dashboard-stats";

describe("order dashboard status buckets", () => {
  it("defines active as the exact union of the operational and balance cards", () => {
    const cards = [
      ...IN_PRODUCTION_STATUSES,
      ...AWAITING_SHIPMENT_STATUSES,
      ...READY_FOR_INSTALLATION_STATUSES,
      ...AWAITING_BALANCE_STATUSES,
    ];
    expect(ACTIVE_ORDER_STATUSES).toEqual(cards);
    expect(new Set(cards).size).toBe(cards.length);
  });

  it("does not count quotation or other pre-production stages as active", () => {
    expect(ACTIVE_ORDER_STATUSES).not.toContain("order_recorded");
    expect(ACTIVE_ORDER_STATUSES).not.toContain("quotation_sent");
    expect(ACTIVE_ORDER_STATUSES).not.toContain("deposit_received");
    expect(ACTIVE_ORDER_STATUSES).not.toContain("po_ready");
    expect(ACTIVE_ORDER_STATUSES).not.toContain("completed");
  });

  it("shows every unfinished order in the default list", () => {
    expect(DEFAULT_ORDER_LIST_STATUSES).toEqual([
      "order_recorded",
      "quotation_sent",
      "deposit_received",
      "po_ready",
      ...ACTIVE_ORDER_STATUSES,
    ]);
    expect(DEFAULT_ORDER_LIST_STATUSES).not.toContain("completed");
  });
});
