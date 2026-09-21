import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({
  windows: [] as Record<string, unknown>[],
  addons: [] as { window_id: string; addon_key: string }[],
}));
vi.mock("@/lib/db/kysely", () => ({ db: {
  selectFrom(table: string) {
    const chain = {
      innerJoin: () => chain, leftJoin: () => chain, select: () => chain,
      where: () => chain, orderBy: () => chain,
      execute: async () => table === "windows" ? state.windows : state.addons,
      executeTakeFirst: async () => ({ track_note_cn: null }),
    };
    return chain;
  },
} }));
import { loadTrackOrder } from "./track-order-load";
import { railShipmentKind } from "./track-options";

const noOptions = {
  s_fold: false,
  slim_tracks: false,
  side_installation: false,
  overlap_tracks_attachment: false,
};

beforeEach(() => {
  state.windows = [{ window_id: "window", position: 0, room_label: "Bedroom",
    mfg_width_cm: 298, day_curtain_type_id: "day", night_curtain_type_id: "night",
    blind_type_id: null, side_installation: false, overlap_tracks_attachment: false,
    day_track_required: true, night_track_required: true }];
  state.addons = [];
});
describe("track procurement respects saved requirements", () => {
  it("orders a single run when only the day curtain needs a new track", async () => {
    state.windows[0].night_track_required = false;
    const result = await loadTrackOrder("order");
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({ kind: "single", widthCm: 298 });
    expect(railShipmentKind(result.lines[0].options)).toBe("standard_tracks");
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
    state.addons = [{ window_id: "window", addon_key: "s_fold" }];
    const result = await loadTrackOrder("order");
    expect(result.lines).toEqual([]);
    expect(result.unmeasured).toEqual([{ label: "Bedroom — Window 1",
      options: { ...noOptions, s_fold: true } }]);
  });
  it("carries slim tracks onto the line without changing its rail shipment", async () => {
    state.addons = [{ window_id: "window", addon_key: "slim_tracks" }];
    const result = await loadTrackOrder("order");
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].options).toEqual({ ...noOptions, slim_tracks: true });
    expect(railShipmentKind(result.lines[0].options)).toBe("standard_tracks");
  });
  it("resolves add-on keys and window columns together", async () => {
    state.addons = [
      { window_id: "window", addon_key: "s_fold" },
      { window_id: "window", addon_key: "slim_tracks" },
    ];
    Object.assign(state.windows[0], { side_installation: true, overlap_tracks_attachment: true });
    const result = await loadTrackOrder("order");
    expect(result.lines[0].options).toEqual({
      s_fold: true,
      slim_tracks: true,
      side_installation: true,
      overlap_tracks_attachment: true,
    });
    expect(railShipmentKind(result.lines[0].options)).toBe("s_fold_tracks");
  });
});
