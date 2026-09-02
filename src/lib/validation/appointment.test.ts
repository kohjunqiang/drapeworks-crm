import { describe, expect, it } from "vitest";

import { appointmentStatusSchema } from "./appointment";

const ID = "00000000-0000-4000-8000-000000000001";

describe("appointmentStatusSchema", () => {
  it.each(["cancelled", "no_show"] as const)("allows %s", status => {
    expect(appointmentStatusSchema.safeParse({ id: ID, status }).success).toBe(true);
  });

  it("reserves completion for final order creation", () => {
    expect(appointmentStatusSchema.safeParse({ id: ID, status: "completed" }).success).toBe(false);
  });
});
