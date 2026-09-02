import { describe, expect, it } from "vitest";

import { buildInstallationSummary } from "./installation-summary";

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
});
