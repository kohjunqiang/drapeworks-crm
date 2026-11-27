import { windowLabel } from "@/lib/orders/window-label";

export type InstallationOpening = {
  roomLabel: string;
  /** Ops room-level note, rendered once on the room's first opening. */
  roomNote?: string | null;
  openingNumber: number;
  openingsInRoom: number;
  /** The consultant's location label, when the window carries one. */
  windowName?: string | null;
  covering: "Double" | "Single" | "Blinds" | "Mesh" | "Curtain" | "Track";
  widthCm: number | null;
  heightCm: number | null;
  draw: string | null;
  splitLeftCm?: number | null;
  splitRightCm?: number | null;
  addonLabels: readonly string[];
  sideInstallation: boolean;
  /**
   * Supply-only opening: sold but NOT installed by the crew. Excluded from
   * the install count line and stripped of installation instructions, but
   * still listed so the crew knows it exists.
   */
  noInstallation?: boolean;
  installationNote: string | null;
};

export type InstallationSummaryInput = {
  scheduledAt: Date | string;
  durationMins: number;
  address: string;
  customerName: string;
  customerMobile: string | null;
  /** Ops general instructions for the whole job, when any were saved. */
  generalInstructions?: string | null;
  /** Order-level general note saved on the order, when any was recorded. */
  generalNotes?: string | null;
  openings: InstallationOpening[];
  /** Public installer page link, appended as a final block when present. */
  installerUrl?: string | null;
};

const SG_ZONE = "Asia/Singapore";

function ordinal(day: number): string {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
  if (day % 10 === 1) return `${day}st`;
  if (day % 10 === 2) return `${day}nd`;
  if (day % 10 === 3) return `${day}rd`;
  return `${day}th`;
}

function dateLabel(value: Date | string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SG_ZONE,
    day: "numeric",
    month: "short",
    weekday: "short",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  const month = part("month") === "Sept" ? "Sep" : part("month");
  return `${ordinal(Number(part("day")))} ${month} ${part("weekday")}`;
}

function timeLabel(value: Date): string {
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: SG_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(value)
    .replace(":", ".")
    .replace(/\s/g, "")
    .toLowerCase();
}

function metres(value: number | null): string {
  if (value == null) return "—";
  // Installation corrections can carry decimal centimetres (202.5cm). Render
  // to a hundredth of a centimetre so the copied handoff keeps the precision,
  // then strip trailing zeros so 205cm still reads "2.05m".
  return `${(value / 100).toFixed(4).replace(/\.?0+$/, "")}m`;
}

export function buildInstallationSummary(input: InstallationSummaryInput): string {
  const start = new Date(input.scheduledAt);
  const end = new Date(start.getTime() + input.durationMins * 60_000);

  // The count line describes the crew's work, so supply-only openings are
  // excluded — they are still listed individually below.
  const counts = new Map<InstallationOpening["covering"], number>();
  for (const opening of input.openings) {
    if (opening.noInstallation) continue;
    counts.set(opening.covering, (counts.get(opening.covering) ?? 0) + 1);
  }
  const countLine =
    input.openings.length > 0 && input.openings.every((o) => o.noInstallation)
      ? "No windows require installation"
      : (["Double", "Single", "Blinds", "Mesh", "Curtain", "Track"] as const)
          .flatMap((kind) => {
            const count = counts.get(kind) ?? 0;
            return count > 0 ? [`${count} ${kind}`] : [];
          })
          .join(" ");

  const header = [
    dateLabel(start),
    `Time: ${timeLabel(start)}-${timeLabel(end)}`,
    `Address: ${input.address}`,
    `Customer Name: ${input.customerName}`,
    input.customerMobile ? `Mobile Number: ${input.customerMobile}` : null,
  ].filter((line): line is string => line != null);

  const details = input.openings.map((opening) => {
    const room =
      opening.openingsInRoom > 1 || opening.windowName?.trim()
        ? `${opening.roomLabel} - ${windowLabel(opening.openingNumber - 1, opening.windowName)}`
        : opening.roomLabel;
    const drawDescription =
      opening.splitLeftCm != null && opening.splitRightCm != null
        ? `Draw: 2 × Single draw — L ${metres(opening.splitLeftCm)} / R ${metres(opening.splitRightCm)}`
        : opening.draw
          ? `Draw: ${opening.draw}`
          : null;
    return [
      `${room}: ${opening.covering}`,
      opening.openingNumber === 1 && opening.roomNote
        ? `Room note: ${opening.roomNote}`
        : null,
      opening.noInstallation ? "No installation — supply only" : null,
      `${metres(opening.widthCm)} Width ${metres(opening.heightCm)} Height`,
      drawDescription,
      opening.addonLabels.length > 0
        ? `Add-ons: ${opening.addonLabels.join(", ")}`
        : null,
      // Installation instructions are meaningless on a supply-only opening —
      // nothing is being mounted, so the crew must not read them as work.
      !opening.noInstallation && opening.sideInstallation
        ? "Side-installation: Yes"
        : null,
      !opening.noInstallation && opening.installationNote
        ? `Installation note: ${opening.installationNote}`
        : null,
    ]
      .filter((line): line is string => line != null)
      .join("\n");
  });

  return [
    header.join("\n"),
    countLine,
    input.generalInstructions
      ? `Instructions: ${input.generalInstructions}`
      : null,
    input.generalNotes?.trim()
      ? `General note: ${input.generalNotes.trim()}`
      : null,
    ...details,
    input.installerUrl ? `Photos & measurements: ${input.installerUrl}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}
