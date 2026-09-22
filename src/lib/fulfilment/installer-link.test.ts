import { afterEach, describe, expect, it } from "vitest";

import {
  INSTALLER_LINK_COMPLETED_DAYS,
  installerPageUrl,
  isInstallerLinkActive,
} from "./installer-link";

const DAY_MS = 24 * 60 * 60 * 1000;
const now = new Date("2026-09-22T04:00:00.000Z");

describe("isInstallerLinkActive", () => {
  it("is active while the order is in flight", () => {
    for (const orderStatus of [
      "delivered_checked",
      "fulfilment",
      "installation_completed",
    ] as const) {
      expect(
        isInstallerLinkActive(
          { cancelledAt: null, orderStatus, completedAt: null },
          now,
        ),
      ).toBe(true);
    }
  });

  it("is inactive the moment the booking is cancelled", () => {
    expect(
      isInstallerLinkActive(
        {
          cancelledAt: new Date("2026-09-20T00:00:00.000Z"),
          orderStatus: "fulfilment",
          completedAt: null,
        },
        now,
      ),
    ).toBe(false);
  });

  it("stays active inside the post-completion window", () => {
    expect(
      isInstallerLinkActive(
        {
          cancelledAt: null,
          orderStatus: "completed",
          completedAt: new Date(now.getTime() - 13 * DAY_MS),
        },
        now,
      ),
    ).toBe(true);
  });

  it("expires at exactly 14 days after completion", () => {
    expect(
      isInstallerLinkActive(
        {
          cancelledAt: null,
          orderStatus: "completed",
          completedAt: new Date(
            now.getTime() - INSTALLER_LINK_COMPLETED_DAYS * DAY_MS,
          ),
        },
        now,
      ),
    ).toBe(false);
  });

  it("is inactive well past the window", () => {
    expect(
      isInstallerLinkActive(
        {
          cancelledAt: null,
          orderStatus: "completed",
          completedAt: new Date(now.getTime() - 15 * DAY_MS),
        },
        now,
      ),
    ).toBe(false);
  });

  it("is inactive when a completed order has no completed event", () => {
    expect(
      isInstallerLinkActive(
        { cancelledAt: null, orderStatus: "completed", completedAt: null },
        now,
      ),
    ).toBe(false);
  });
});

describe("installerPageUrl", () => {
  const original = process.env.NEXT_PUBLIC_SITE_URL;
  afterEach(() => {
    if (original === undefined) {
      delete process.env.NEXT_PUBLIC_SITE_URL;
    } else {
      process.env.NEXT_PUBLIC_SITE_URL = original;
    }
  });

  it("builds the public URL from the site origin", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://crm.drapeworks.sg";
    expect(installerPageUrl("tok-1")).toBe(
      "https://crm.drapeworks.sg/install/tok-1",
    );
  });

  it("strips a trailing slash from the site origin", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://crm.drapeworks.sg/";
    expect(installerPageUrl("tok-1")).toBe(
      "https://crm.drapeworks.sg/install/tok-1",
    );
  });

  it("returns null when the site origin is unset or empty", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(installerPageUrl("tok-1")).toBeNull();
    process.env.NEXT_PUBLIC_SITE_URL = "";
    expect(installerPageUrl("tok-1")).toBeNull();
  });
});
