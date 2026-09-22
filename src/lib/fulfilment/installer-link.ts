import type { FulfilmentStatus } from "@/lib/db/schema";

/**
 * The token on an installation booking opens the public /install/<token>
 * page. These rules decide when that page answers: the link dies the moment
 * the booking is cancelled, and it expires a fortnight after the order
 * entered Completed so a forgotten WhatsApp message stops working on its own.
 */
export const INSTALLER_LINK_COMPLETED_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

export type InstallerLinkState = {
  cancelledAt: Date | string | null;
  orderStatus: FulfilmentStatus;
  /** When the order entered Completed for the current stint, if it has. */
  completedAt: Date | string | null;
};

export function isInstallerLinkActive(
  state: InstallerLinkState,
  now: Date = new Date(),
): boolean {
  if (state.cancelledAt) return false;
  if (state.orderStatus === "completed") {
    // A completed order with no completed event on record has no expiry to
    // compute, so the safe answer is inactive.
    if (!state.completedAt) return false;
    const expiry =
      new Date(state.completedAt).getTime() +
      INSTALLER_LINK_COMPLETED_DAYS * DAY_MS;
    return now.getTime() < expiry;
  }
  return true;
}

/**
 * The absolute URL the installer is sent. null when NEXT_PUBLIC_SITE_URL is
 * unset — a relative or broken link must never reach the copied text.
 */
export function installerPageUrl(token: string): string | null {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ?? "";
  return base ? `${base}/install/${token}` : null;
}
