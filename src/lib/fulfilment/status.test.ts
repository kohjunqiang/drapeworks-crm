import { describe, expect, it } from "vitest";

import { canScheduleInstallation } from "./status";

describe("canScheduleInstallation", () => {
  it("allows advance scheduling once PO measurements are ready", () => {
    expect(canScheduleInstallation("po_ready")).toBe(true);
    expect(canScheduleInstallation("sent_to_vendor")).toBe(true);
    expect(canScheduleInstallation("shipping_sg")).toBe(true);
    expect(canScheduleInstallation("delivered_checked")).toBe(true);
    expect(canScheduleInstallation("fulfilment")).toBe(true);
  });

  it("does not schedule before measurements are frozen or after completion", () => {
    expect(canScheduleInstallation("deposit_received")).toBe(false);
    expect(canScheduleInstallation("completed")).toBe(false);
  });
});
