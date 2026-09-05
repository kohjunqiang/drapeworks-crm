import { describe, expect, it } from "vitest";

import {
  appointmentCreateSchema,
  appointmentStatusSchema,
} from "./appointment";

const ID = "00000000-0000-4000-8000-000000000001";

const validAppointment = {
  lead_id: crypto.randomUUID(),
  consultant_id: crypto.randomUUID(),
  date: "2026-09-08",
  time: "14:00",
  duration_mins: 90,
  address: "12 Lynwood Grove, Singapore 358172",
  customer: {
    mode: "new" as const,
    name: "Bren",
    mobile: "9123 4567",
    email: "",
  },
};

describe("appointment booking validation", () => {
  it("requires an installation address before booking", () => {
    expect(
      appointmentCreateSchema.safeParse({ ...validAppointment, address: "" })
        .success,
    ).toBe(false);
  });

  it("requires a mobile number when creating the customer", () => {
    expect(
      appointmentCreateSchema.safeParse({
        ...validAppointment,
        customer: { ...validAppointment.customer, mobile: "" },
      }).success,
    ).toBe(false);
  });

  it("accepts a booking with both required contact details", () => {
    expect(appointmentCreateSchema.safeParse(validAppointment).success).toBe(
      true,
    );
  });
});

describe("appointmentStatusSchema", () => {
  it.each(["cancelled", "no_show"] as const)("allows %s", (status) => {
    expect(appointmentStatusSchema.safeParse({ id: ID, status }).success).toBe(
      true,
    );
  });

  it("reserves completion for final order creation", () => {
    expect(
      appointmentStatusSchema.safeParse({ id: ID, status: "completed" })
        .success,
    ).toBe(false);
  });
});
