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

type WindowRow = {
  id: string;
  room_id: string;
  position: number;
  width_cm: number | null;
  height_cm: number | null;
  notes: string | null;
  side_installation: boolean;
  no_installation: boolean;
  draw: string | null;
  day_curtain_type_id: string | null;
  night_curtain_type_id: string | null;
  blind_type_id: string | null;
};

const splitPanel: MeshPanelRow = {
  id: "e31fd642-0fe2-4066-9762-880b0e023471",
  room_id: "c31fd642-0fe2-4066-9762-880b0e023471",
  position: 1,
  width_cm: 184,
  height_cm: 210,
  draw: "Double",
  split_left_cm: 62,
  split_right_cm: 122,
  notes: null,
};

const curtainWindow: WindowRow = {
  id: "d31fd642-0fe2-4066-9762-880b0e023471",
  room_id: "c31fd642-0fe2-4066-9762-880b0e023471",
  position: 1,
  width_cm: 210,
  height_cm: 260,
  notes: "Ceiling mount",
  side_installation: false,
  no_installation: false,
  draw: "Double",
  day_curtain_type_id: "ct-day",
  night_curtain_type_id: "ct-night",
  blind_type_id: null,
};

const blindWindow: WindowRow = {
  id: "d41fd642-0fe2-4066-9762-880b0e023471",
  room_id: "c31fd642-0fe2-4066-9762-880b0e023471",
  position: 2,
  width_cm: 80,
  height_cm: 140,
  notes: null,
  side_installation: false,
  no_installation: false,
  draw: "Single Left",
  day_curtain_type_id: null,
  night_curtain_type_id: null,
  blind_type_id: "ct-blind",
};

const queriedColumns: { table: string; columns: unknown }[] = [];

function chain(result: unknown, table: string) {
  const node: Record<string, unknown> = {
    innerJoin: () => node,
    select: (columns: unknown) => {
      queriedColumns.push({ table, columns });
      return node;
    },
    where: () => node,
    orderBy: () => node,
    execute: async () => result,
    executeTakeFirst: async () => result,
    executeTakeFirstOrThrow: async () => result,
  };
  return node;
}

function setup(opts: {
  productLine?: "curtain" | "mesh";
  panels?: MeshPanelRow[];
  windows?: WindowRow[];
  frozen?: FrozenRow[];
  details?: unknown;
  generalNotes?: string | null;
}) {
  const rows: Record<string, unknown> = {
    orders: {
      id: orderId,
      display_id: "DW-2026-0025",
      order_reference: "M25ABCDE",
      product_line: opts.productLine ?? "mesh",
      general_notes: opts.generalNotes ?? null,
      customer_name: "Tan Ah Kow",
      customer_mobile: "9123 4567",
    },
    rooms: [{ id: "c31fd642-0fe2-4066-9762-880b0e023471", label: "Living Room", position: 1 }],
    manufacture_measurements: opts.frozen ?? [],
    mesh_panels: opts.panels ?? [],
    windows: opts.windows ?? [],
    window_addons: [],
    fulfilment_arrangements: {
      installation_details: opts.details ?? null,
    },
  };
  mocks.selectFrom.mockImplementation((table: string) =>
    chain(rows[table] ?? [], table),
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
  queriedColumns.length = 0;
});

describe("loadInstallationSummary mesh openings", () => {
  it("renders a split double-draw panel from the panel row when the frozen split is null", async () => {
    setup({
      panels: [splitPanel],
      frozen: [
        {
          window_id: null,
          mesh_panel_id: "e31fd642-0fe2-4066-9762-880b0e023471",
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

describe("loadInstallationSummary installation-detail overrides", () => {
  it("applies size and note overrides on a curtain opening and keeps the frozen fallback for untouched fields", async () => {
    setup({
      productLine: "curtain",
      windows: [curtainWindow],
      frozen: [
        {
          window_id: "d31fd642-0fe2-4066-9762-880b0e023471",
          mesh_panel_id: null,
          mfg_width_cm: 205,
          mfg_height_cm: 255,
          mfg_split_left_cm: null,
          mfg_split_right_cm: null,
        },
      ],
      details: {
        openings: {
          "d31fd642-0fe2-4066-9762-880b0e023471": { width_cm: 199, note: "Drill into concrete beam" },
        },
      },
    });
    const { text } = await load();
    expect(text).toContain("1.99m Width 2.55m Height");
    expect(text).toContain("Installation note: Drill into concrete beam");
    expect(text).not.toContain("Ceiling mount");
  });

  it("renders general instructions and a room note ahead of the openings", async () => {
    setup({
      productLine: "curtain",
      windows: [curtainWindow],
      details: {
        general_instructions: "Bring a 3m ladder",
        rooms: { "c31fd642-0fe2-4066-9762-880b0e023471": { note: "False ceiling — longer screws" } },
      },
    });
    const { text } = await load();
    expect(text).toContain("Instructions: Bring a 3m ladder");
    expect(text).toContain("Room note: False ceiling — longer screws");
    expect(text).toContain("Installation note: Ceiling mount");
  });

  it("an empty note override explicitly clears the inherited note", async () => {
    setup({
      productLine: "curtain",
      windows: [curtainWindow],
      details: { openings: { "d31fd642-0fe2-4066-9762-880b0e023471": { note: "" } } },
    });
    const { text } = await load();
    expect(text).not.toContain("Ceiling mount");
    expect(text).not.toContain("Installation note:");
  });

  it("lists blinds and curtains side by side with per-window overrides", async () => {
    setup({
      productLine: "curtain",
      windows: [curtainWindow, blindWindow],
      details: { openings: { "d41fd642-0fe2-4066-9762-880b0e023471": { height_cm: 135 } } },
    });
    const { text } = await load();
    expect(text).toContain("1 Blinds");
    expect(text).toContain("0.8m Width 1.35m Height");
    expect(text).toContain("2.1m Width 2.6m Height");
  });

  it("falls back to the measured size on the untouched axis when no frozen row exists (window)", async () => {
    setup({
      productLine: "curtain",
      windows: [curtainWindow],
      details: {
        openings: {
          "d31fd642-0fe2-4066-9762-880b0e023471": { width_cm: 199 },
        },
      },
    });
    const { text } = await load();
    expect(text).toContain("1.99m Width 2.6m Height");
  });

  it("falls back to the measured size on the untouched axis when no frozen row exists (mesh)", async () => {
    setup({
      panels: [{ ...splitPanel, split_left_cm: null, split_right_cm: null }],
      details: {
        openings: {
          "e31fd642-0fe2-4066-9762-880b0e023471": { width_cm: 175 },
        },
      },
    });
    const { text } = await load();
    expect(text).toContain("1.75m Width 2.1m Height");
  });

  it("lets a refrozen size flow through an axis that was never overridden", async () => {
    setup({
      productLine: "curtain",
      windows: [curtainWindow],
      frozen: [
        {
          window_id: "d31fd642-0fe2-4066-9762-880b0e023471",
          mesh_panel_id: null,
          mfg_width_cm: 208,
          mfg_height_cm: 258,
          mfg_split_left_cm: null,
          mfg_split_right_cm: null,
        },
      ],
      details: {
        openings: {
          "d31fd642-0fe2-4066-9762-880b0e023471": { width_cm: 199 },
        },
      },
    });
    const { text } = await load();
    // The corrected width holds; the refrozen height shows on the untouched axis.
    expect(text).toContain("1.99m Width 2.58m Height");
  });

  it("applies overrides to mesh panels over the frozen size", async () => {
    setup({
      panels: [splitPanel],
      frozen: [
        {
          window_id: null,
          mesh_panel_id: "e31fd642-0fe2-4066-9762-880b0e023471",
          mfg_width_cm: 180,
          mfg_height_cm: 205,
          mfg_split_left_cm: null,
          mfg_split_right_cm: null,
        },
      ],
      details: {
        openings: { "e31fd642-0fe2-4066-9762-880b0e023471": { width_cm: 175, note: "Trim on site" } },
      },
    });
    const { text } = await load();
    expect(text).toContain("1.75m Width 2.05m Height");
    expect(text).toContain("Installation note: Trim on site");
  });
});

describe("loadInstallationSummary general note", () => {
  it("selects orders.general_notes and forwards the note for a curtain order", async () => {
    setup({
      productLine: "curtain",
      windows: [curtainWindow],
      generalNotes: "Beware of dog",
    });
    const { text } = await load();
    const ordersSelect = queriedColumns.find((q) => q.table === "orders");
    expect(ordersSelect?.columns).toEqual(
      expect.arrayContaining(["orders.general_notes"]),
    );
    expect(text).toContain("General note: Beware of dog");
  });

  it("forwards the note for a mesh order", async () => {
    setup({ panels: [splitPanel], generalNotes: "Call before arriving" });
    const { text } = await load();
    expect(text).toContain("General note: Call before arriving");
  });

  it("keeps the note separate from ops instructions when both exist", async () => {
    setup({
      panels: [splitPanel],
      generalNotes: "Customer prefers afternoon",
      details: { general_instructions: "Bring a 3m ladder" },
    });
    const { text } = await load();
    expect(text).toContain("Instructions: Bring a 3m ladder");
    expect(text).toContain("General note: Customer prefers afternoon");
  });

  it("omits the block when the order has no note", async () => {
    setup({ panels: [splitPanel] });
    const { text } = await load();
    expect(text).not.toContain("General note");
  });
});
