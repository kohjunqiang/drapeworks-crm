import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({
  windows: [] as Record<string, unknown>[],
  sFold: [] as { window_id: string }[],
}));
vi.mock("@/lib/db/kysely", () => ({ db: {
  selectFrom(table: string) {
    const chain = {
      innerJoin: () => chain, leftJoin: () => chain, select: () => chain,
      where: () => chain, orderBy: () => chain,
      execute: async () => table === "windows" ? state.windows : state.sFold,
      executeTakeFirst: async () => ({ track_note_cn: null }),
    };
    return chain;
  },
} }));
import { loadTrackOrder } from "./track-order-load";

beforeEach(() => {
  state.windows = [{ window_id: "window", position: 0, room_label: "Bedroom",
    mfg_width_cm: 298, day_curtain_type_id: "day", night_curtain_type_id: "night",
    blind_type_id: null, side_installation: false, overlap_tracks_attachment: false,
    day_track_required: true, night_track_required: true }];
  state.sFold = [];
});
describe("track procurement respects saved requirements", () => {
  it("orders a single run when only the day curtain needs a new track", async () => {
    state.windows[0].night_track_required = false;
    const result = await loadTrackOrder("order");
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({ kind: "single", widthCm: 298, shipmentKind: "standard_tracks" });
  });
  it("orders a double run by default", async () => {
    expect((await loadTrackOrder("order")).lines[0].kind).toBe("double");
  });
  it("omits unnecessary tracks even when their manufacturing width is missing", async () => {
    Object.assign(state.windows[0], { day_track_required: false, night_track_required: false, mfg_width_cm: null });
    expect(await loadTrackOrder("order")).toEqual({ lines: [], unmeasured: [], noteCn: null });
  });
  it("still flags a missing width for a required night track and preserves S-fold routing", async () => {
    Object.assign(state.windows[0], { day_track_required: false, mfg_width_cm: null });
    state.sFold = [{ window_id: "window" }];
    const result = await loadTrackOrder("order");
    expect(result.lines).toEqual([]);
    expect(result.unmeasured).toEqual([{ label: "Bedroom — Window 1", shipmentKind: "s_fold_tracks", overlapTracksAttachment: false }]);
  });
});
