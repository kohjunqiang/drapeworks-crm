import { describe, expect, it } from "vitest";

import {
  buildInstallationSummary,
  type InstallationOpening,
} from "./installation-summary";

describe("buildInstallationSummary", () => {
  it("formats a Singapore installation block with counts and instructions", () => {
    const text = buildInstallationSummary({
      scheduledAt: "2026-09-03T02:30:00.000Z",
      durationMins: 60,
      address: "957B Tampines St 96 #08-146",
      customerName: "Omar",
      customerMobile: "90401304",
      openings: [
        {
          roomLabel: "Living Room",
          openingNumber: 1,
          openingsInRoom: 1,
          covering: "Double",
          widthCm: 274,
          heightCm: 255,
          draw: "Double",
          addonLabels: ["S-Fold"],
          sideInstallation: true,
          installationNote: "Day curtain not arrived yet.",
        },
      ],
    });

    expect(text).toContain("3rd Sep Thu\nTime: 10.30am-11.30am");
    expect(text).toContain("1 Double");
    expect(text).toContain("2.74m Width 2.55m Height");
    expect(text).toContain("Add-ons: S-Fold");
    expect(text).toContain("Side-installation: Yes");
    expect(text).toContain("Installation note: Day curtain not arrived yet.");
  });

  it("uses the correct ordinal suffix for teen dates", () => {
    const text = buildInstallationSummary({
      scheduledAt: "2026-09-13T02:00:00.000Z",
      durationMins: 60,
      address: "A",
      customerName: "B",
      customerMobile: null,
      openings: [],
    });
    expect(text).toMatch(/^13th Sep Sun/);
  });

  it("describes a confirmed double-draw split as two single draws", () => {
    const text = buildInstallationSummary({
      scheduledAt: "2026-09-03T02:30:00.000Z",
      durationMins: 60,
      address: "Address",
      customerName: "Customer",
      customerMobile: null,
      openings: [
        {
          roomLabel: "Living Room",
          openingNumber: 1,
          openingsInRoom: 1,
          covering: "Double",
          widthCm: 255,
          heightCm: 288,
          draw: "Double",
          splitLeftCm: 137,
          splitRightCm: 118,
          addonLabels: [],
          sideInstallation: false,
          installationNote: null,
        },
      ],
    });

    expect(text).toContain(
      "Draw: 2 × Single draw — L 1.37m / R 1.18m",
    );
    expect(text).not.toContain("Draw: Double");
  });

  it("numbers multiple windows in one room and tolerates missing measurements", () => {
    const base = {
      roomLabel: "Living Room",
      openingsInRoom: 2,
      widthCm: null,
      heightCm: null,
      draw: null,
      addonLabels: [],
      sideInstallation: false,
      installationNote: null,
    } as const;
    const text = buildInstallationSummary({
      scheduledAt: "2026-09-03T02:30:00.000Z",
      durationMins: 60,
      address: "Address",
      customerName: "Customer",
      customerMobile: null,
      openings: [
        { ...base, openingNumber: 1, covering: "Double" },
        { ...base, openingNumber: 2, covering: "Blinds" },
      ],
    });

    expect(text).toContain("1 Double 1 Blinds");
    expect(text).toContain("Living Room - Window 1: Double");
    expect(text).toContain("Living Room - Window 2: Blinds");
    expect(text).toContain("— Width — Height");
    expect(text).not.toContain("Mobile Number:");
  });

  it("appends the installer page link as a final block when given", () => {
    const base = {
      scheduledAt: "2026-09-03T02:30:00.000Z",
      durationMins: 60,
      address: "Address",
      customerName: "Customer",
      customerMobile: null,
      openings: [],
    };
    const withUrl = buildInstallationSummary({
      ...base,
      installerUrl: "https://crm.example.com/install/abc-123",
    });
    expect(
      withUrl.endsWith(
        "\n\nPhotos & measurements: https://crm.example.com/install/abc-123",
      ),
    ).toBe(true);

    const withoutUrl = buildInstallationSummary(base);
    expect(withoutUrl).not.toContain("Photos & measurements:");
  });
});

describe("buildInstallationSummary — supply-only windows", () => {
  const base = {
    roomLabel: "Living Room",
    openingsInRoom: 3,
    widthCm: 200,
    heightCm: 240,
    draw: null,
    addonLabels: [],
    sideInstallation: false,
    installationNote: null,
  } as const;
  const input = (openings: InstallationOpening[]) => ({
    scheduledAt: "2026-09-03T02:30:00.000Z",
    durationMins: 60,
    address: "Address",
    customerName: "Customer",
    customerMobile: null,
    openings,
  });

  it("excludes flagged windows from the count but keeps them listed and numbered", () => {
    const text = buildInstallationSummary(
      input([
        { ...base, openingNumber: 1, covering: "Double", noInstallation: true },
        { ...base, openingNumber: 2, covering: "Single" },
        { ...base, openingNumber: 3, covering: "Blinds", noInstallation: true },
      ]),
    );

    expect(text).toContain("1 Single");
    expect(text).not.toContain("1 Double");
    expect(text).not.toContain("1 Blinds");
    // The crew still sees every opening, numbered as captured, marked clearly.
    expect(text).toContain("Living Room - Window 1: Double");
    expect(text).toContain("Living Room - Window 3: Blinds");
    expect(text.match(/No installation — supply only/g)).toHaveLength(2);
  });

  it("strips installation instructions from a supply-only entry", () => {
    const text = buildInstallationSummary(
      input([
        {
          ...base,
          openingsInRoom: 1,
          openingNumber: 1,
          covering: "Double",
          noInstallation: true,
          sideInstallation: true,
          installationNote: "Beam too high for ladder.",
        },
      ]),
    );

    expect(text).toContain("No installation — supply only");
    expect(text).not.toContain("Side-installation: Yes");
    expect(text).not.toContain("Installation note:");
  });

  it("says so explicitly when no window requires installation", () => {
    const text = buildInstallationSummary(
      input([
        { ...base, openingsInRoom: 2, openingNumber: 1, covering: "Double", noInstallation: true },
        { ...base, openingsInRoom: 2, openingNumber: 2, covering: "Blinds", noInstallation: true },
      ]),
    );

    expect(text).toContain("No windows require installation");
    expect(text).toContain("Living Room - Window 1: Double");
    expect(text).toContain("Living Room - Window 2: Blinds");
  });

  it("counts an opening with the flag omitted — legacy rows still install", () => {
    const text = buildInstallationSummary(
      input([{ ...base, openingsInRoom: 1, openingNumber: 1, covering: "Double" }]),
    );
    expect(text).toContain("1 Double");
    expect(text).not.toContain("No installation — supply only");
    expect(text).not.toContain("No windows require installation");
  });

  it("counts mesh panels as install work — the flag is a windows feature only", () => {
    const text = buildInstallationSummary(
      input([{ ...base, openingsInRoom: 1, openingNumber: 1, covering: "Mesh" }]),
    );
    expect(text).toContain("1 Mesh");
    expect(text).not.toContain("No installation — supply only");
  });
});
