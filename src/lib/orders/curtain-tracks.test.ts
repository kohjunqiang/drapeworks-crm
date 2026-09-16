import { describe, expect, it } from "vitest";
import { newCurtainTrackCount } from "./curtain-tracks";
import { windowEditSchema } from "@/lib/validation/order";

const day = "550e8400-e29b-41d4-a716-446655440000";
describe("per-curtain track requirements", () => {
  it.each([
    [true, true, true, true, 2], [true, true, false, true, 1],
    [true, true, true, false, 1], [true, true, false, false, 0],
    [true, false, false, true, 0], [false, true, true, false, 0],
    [false, false, true, true, 0],
  ])("counts only selected layers needing new tracks", (hasDay, hasNight, dayRequired, nightRequired, expected) => {
    expect(newCurtainTrackCount(Boolean(hasDay), Boolean(hasNight), Boolean(dayRequired), Boolean(nightRequired))).toBe(expected);
  });
  it("keeps false through form validation", () => {
    const result = windowEditSchema.parse({ variant: "regular", position: 0, day_curtain_type_id: day, day_track_required: false, night_track_required: true });
    expect(result).toMatchObject({ day_track_required: false, night_track_required: true });
  });
  it("rejects strings so false cannot become truthy", () => {
    expect(windowEditSchema.safeParse({ variant: "regular", position: 0, day_track_required: "false" }).success).toBe(false);
  });
});
