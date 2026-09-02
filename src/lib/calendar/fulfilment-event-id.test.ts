import { describe, expect, it } from "vitest";

import { fulfilmentCalendarEventId } from "./fulfilment-event-id";

describe("fulfilmentCalendarEventId", () => {
  it("turns the arrangement UUID into a stable Google base32hex id", () => {
    expect(
      fulfilmentCalendarEventId("A0B1C2D3-E4F5-4678-9ABC-DEF012345678"),
    ).toBe("a0b1c2d3e4f546789abcdef012345678");
  });
});
