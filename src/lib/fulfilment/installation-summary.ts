export type InstallationOpening = {
  roomLabel: string;
  openingNumber: number;
  openingsInRoom: number;
  covering: "Double" | "Single" | "Blinds" | "Mesh" | "Curtain";
  widthCm: number | null;
  heightCm: number | null;
  draw: string | null;
  splitLeftCm?: number | null;
  splitRightCm?: number | null;
  addonLabels: readonly string[];
  sideInstallation: boolean;
  installationNote: string | null;
};

export type InstallationSummaryInput = {
  scheduledAt: Date | string;
  durationMins: number;
  address: string;
  customerName: string;
  customerMobile: string | null;
  openings: InstallationOpening[];
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
  return `${Number((value / 100).toFixed(2))}m`;
}

export function buildInstallationSummary(input: InstallationSummaryInput): string {
  const start = new Date(input.scheduledAt);
  const end = new Date(start.getTime() + input.durationMins * 60_000);

  const counts = new Map<InstallationOpening["covering"], number>();
  for (const opening of input.openings) {
    counts.set(opening.covering, (counts.get(opening.covering) ?? 0) + 1);
  }
  const countLine = (["Double", "Single", "Blinds", "Mesh", "Curtain"] as const)
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
      opening.openingsInRoom > 1
        ? `${opening.roomLabel} - Window ${opening.openingNumber}`
        : opening.roomLabel;
    const drawDescription =
      opening.splitLeftCm != null && opening.splitRightCm != null
        ? `Draw: 2 × Single draw — L ${metres(opening.splitLeftCm)} / R ${metres(opening.splitRightCm)}`
        : opening.draw
          ? `Draw: ${opening.draw}`
          : null;
    return [
      `${room}: ${opening.covering}`,
      `${metres(opening.widthCm)} Width ${metres(opening.heightCm)} Height`,
      drawDescription,
      opening.addonLabels.length > 0
        ? `Add-ons: ${opening.addonLabels.join(", ")}`
        : null,
      opening.sideInstallation ? "Side-installation: Yes" : null,
      opening.installationNote
        ? `Installation note: ${opening.installationNote}`
        : null,
    ]
      .filter((line): line is string => line != null)
      .join("\n");
  });

  return [header.join("\n"), countLine, ...details]
    .filter(Boolean)
    .join("\n\n");
}
