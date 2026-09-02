import { describe, expect, it } from "vitest";

import {
  STATUS_COLOURS,
  STATUS_FLOW,
  STATUS_LABELS,
  isLocked,
  leadMilestoneForOrderStatus,
  leadStateForRevertedOrderStatus,
  nextStatus,
  statusIndex,
} from "./status-flow";

describe("STATUS_FLOW", () => {
  it("runs recorded → deposit → PO ready → vendor → logistics → shipping → delivered → fulfilment → completed", () => {
    expect(STATUS_FLOW).toEqual([
      "order_recorded",
      "quotation_sent",
      "deposit_received",
      "po_ready",
      "sent_to_vendor",
      "sent_logistic",
      "shipping_sg",
      "delivered_checked",
      "fulfilment",
      "completed",
    ]);
  });

  // STATUS_FLOW is typed FulfilmentStatus[], not an exhaustive tuple. A new
  // status added to the enum would be forced into STATUS_LABELS and
  // STATUS_COLOURS by their Record type, but nothing forces it into the flow —
  // and an order sitting on a status the flow omits can never advance, because
  // statusIndex returns -1 and nextStatus then returns null. This is the only
  // thing that catches that.
  it("contains every status the type defines", () => {
    expect([...STATUS_FLOW].sort()).toEqual(Object.keys(STATUS_LABELS).sort());
  });

  it("labels and colours every status", () => {
    for (const s of STATUS_FLOW) {
      expect(STATUS_LABELS[s]).toBeTruthy();
      expect(STATUS_COLOURS[s]).toBeTruthy();
    }
  });
});

describe("linked lead milestones", () => {
  it("moves a quoted customer to decision pending", () => {
    expect(leadMilestoneForOrderStatus("quotation_sent")).toEqual({ stage: "Decision Pending", outcome: "Quotation Sent" });
  });
  it("wins the lead when the deposit is received", () => {
    expect(leadMilestoneForOrderStatus("deposit_received")).toEqual({ stage: "Won", outcome: "Customer Confirmed" });
  });
  it("does not change leads for fulfilment-only statuses", () => {
    expect(leadMilestoneForOrderStatus("po_ready")).toBeNull();
  });
  it("restores Send Quotation when quotation status is reverted", () => {
    expect(leadStateForRevertedOrderStatus("order_recorded")).toEqual({
      stage: "Send Quotation", outcome: null,
    });
  });
  it("restores Decision Pending when deposit status is reverted", () => {
    expect(leadStateForRevertedOrderStatus("quotation_sent")).toEqual({
      stage: "Decision Pending", outcome: "Quotation Sent",
    });
  });
});

describe("nextStatus", () => {
  it("separates measurement confirmation from vendor dispatch", () => {
    expect(nextStatus("order_recorded")).toBe("quotation_sent");
    expect(nextStatus("quotation_sent")).toBe("deposit_received");
    expect(nextStatus("deposit_received")).toBe("po_ready");
    expect(nextStatus("po_ready")).toBe("sent_to_vendor");
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

describe("isLocked", () => {
  it("is false before the order reaches the vendor", () => {
    expect(isLocked("order_recorded")).toBe(false);
    expect(isLocked("quotation_sent")).toBe(false);
    expect(isLocked("deposit_received")).toBe(false);
  });

  it("is true once measurements are frozen at PO Ready", () => {
    expect(isLocked("po_ready")).toBe(true);
    expect(isLocked("sent_to_vendor")).toBe(true);
    expect(isLocked("sent_logistic")).toBe(true);
    expect(isLocked("shipping_sg")).toBe(true);
    expect(isLocked("delivered_checked")).toBe(true);
    expect(isLocked("fulfilment")).toBe(true);
    expect(isLocked("completed")).toBe(true);
  });
});
