import { describe, expect, it } from "vitest";

import { appointmentCalendarEventId } from "./appointment-event-id";

describe("appointmentCalendarEventId", () => {
  it("names an appointment event deterministically without colliding with other event types", () => {
    expect(
      appointmentCalendarEventId("A0B1C2D3-E4F5-4678-9ABC-DEF012345678"),
    ).toBe("aa0b1c2d3e4f546789abcdef012345678");
  });
});
