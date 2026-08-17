import { describe, expect, it } from "vitest";

import {
  STATUS_COLOURS,
  STATUS_FLOW,
  STATUS_LABELS,
  nextStatus,
  statusIndex,
} from "./status-flow";

describe("STATUS_FLOW", () => {
  it("runs recorded → deposit → vendor → logistics → shipping → delivered → fulfilment → completed", () => {
    expect(STATUS_FLOW).toEqual([
      "order_recorded",
      "deposit_received",
      "sent_to_vendor",
      "sent_logistic",
      "shipping_sg",
      "delivered_checked",
      "fulfilment",
      "completed",
    ]);
  });

  it("labels and colours every status", () => {
    for (const s of STATUS_FLOW) {
      expect(STATUS_LABELS[s]).toBeTruthy();
      expect(STATUS_COLOURS[s]).toBeTruthy();
    }
  });
});

describe("nextStatus", () => {
  it("advances an order through the two new steps", () => {
    expect(nextStatus("order_recorded")).toBe("deposit_received");
    expect(nextStatus("deposit_received")).toBe("sent_to_vendor");
    expect(nextStatus("sent_to_vendor")).toBe("sent_logistic");
  });

  it("returns null at the end of the flow", () => {
    expect(nextStatus("completed")).toBeNull();
  });
});

describe("statusIndex", () => {
  it("orders vendor dispatch before logistics handover", () => {
    expect(statusIndex("sent_to_vendor")).toBeLessThan(
      statusIndex("sent_logistic"),
    );
  });
});
