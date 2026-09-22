import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ selectFrom: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/kysely", () => ({ db: { selectFrom: mocks.selectFrom } }));

import { loadInstallationSummary } from "./load-installation-summary";

const orderId = "a31fd642-0fe2-4066-9762-880b0e023471";
const scheduledAt = "2026-09-25T02:00:00.000Z";

type MeshPanelRow = {
  id: string;
  room_id: string;
  position: number;
  width_cm: number | null;
  height_cm: number | null;
  draw: string | null;
  split_left_cm: number | null;
  split_right_cm: number | null;
  notes: string | null;
};

type FrozenRow = {
  window_id: string | null;
  mesh_panel_id: string | null;
  mfg_width_cm: number | null;
  mfg_height_cm: number | null;
  mfg_split_left_cm: number | null;
  mfg_split_right_cm: number | null;
};

const splitPanel: MeshPanelRow = {
  id: "panel-1",
  room_id: "room-1",
  position: 1,
  width_cm: 184,
  height_cm: 210,
  draw: "Double",
  split_left_cm: 62,
  split_right_cm: 122,
  notes: null,
};

function chain(result: unknown) {
  const node: Record<string, unknown> = {
    innerJoin: () => node,
    select: () => node,
    where: () => node,
    orderBy: () => node,
    execute: async () => result,
    executeTakeFirstOrThrow: async () => result,
  };
  return node;
}

function setup(opts: { panels: MeshPanelRow[]; frozen?: FrozenRow[] }) {
  const rows: Record<string, unknown> = {
    orders: {
      id: orderId,
      display_id: "DW-2026-0025",
      order_reference: "M25ABCDE",
      product_line: "mesh",
      customer_name: "Tan Ah Kow",
      customer_mobile: "9123 4567",
    },
    rooms: [{ id: "room-1", label: "Living Room", position: 1 }],
    manufacture_measurements: opts.frozen ?? [],
    mesh_panels: opts.panels,
  };
  mocks.selectFrom.mockImplementation((table: string) =>
    chain(rows[table] ?? []),
  );
}

const load = (installerToken?: string | null) =>
  loadInstallationSummary(
    orderId,
    scheduledAt,
    60,
    "1 Verify Way",
    installerToken,
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("loadInstallationSummary mesh openings", () => {
  it("renders a split double-draw panel from the panel row when the frozen split is null", async () => {
    setup({
      panels: [splitPanel],
      frozen: [
        {
          window_id: null,
          mesh_panel_id: "panel-1",
          mfg_width_cm: 184,
          mfg_height_cm: 210,
          mfg_split_left_cm: null,
          mfg_split_right_cm: null,
        },
      ],
    });
    const { text } = await load();
    expect(text).toContain("1 Mesh");
    expect(text).toContain("1.84m Width");
    expect(text).toContain("Draw: 2 × Single draw — L 0.62m / R 1.22m");
  });

  it("falls back to the plain draw label when the panel has no split", async () => {
    setup({ panels: [{ ...splitPanel, split_left_cm: null, split_right_cm: null }] });
    const { text } = await load();
    expect(text).toContain("Draw: Double");
    expect(text).not.toContain("2 × Single draw");
  });
});

describe("loadInstallationSummary installer link", () => {
  it("appends the installer page URL as the last line when a token is passed", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://crm.drapeworks.sg");
    setup({ panels: [splitPanel] });
    const { text, installerUrl } = await load("tok-abc");
    const lastLine = text.trim().split("\n").at(-1);
    expect(lastLine).toBe(
      "Photos & measurements: https://crm.drapeworks.sg/install/tok-abc",
    );
    expect(installerUrl).toBe(
      "https://crm.drapeworks.sg/install/tok-abc",
    );
  });

  it("omits the link entirely when no token is passed (calendar-sync call shape)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://crm.drapeworks.sg");
    setup({ panels: [splitPanel] });
    const { text, installerUrl } = await load();
    expect(text).not.toContain("Photos & measurements");
    expect(installerUrl).toBeNull();
  });
});
