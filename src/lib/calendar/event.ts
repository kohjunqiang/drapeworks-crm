export type ConsultationEventInput = {
  customerName: string;
  customerMobile: string | null;
  development: string | null;
  address: string | null;
  notes: string | null;
  quotationBreakdown: string | null;
  leadRef: string;
  leadId: string;
  scheduledAt: Date;
  durationMins: number;
  appUrl: string;
};

export type CalendarEvent = {
  summary: string;
  location?: string;
  description: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
};

/**
 * The Google Calendar event body for a consultation.
 *
 * Deliberately has no `attendees` key: the event is internal. Adding one would
 * make Google email the customer directly, which is not how Drapeworks talks
 * to customers — that happens on WhatsApp.
 */
export function buildConsultationEvent(
  input: ConsultationEventInput,
): CalendarEvent {
  const summary = input.development
    ? `Consultation — ${input.customerName} (${input.development})`
    : `Consultation — ${input.customerName}`;

  const description = [
    input.customerMobile ? `Mobile: ${input.customerMobile}` : null,
    `Lead: ${input.leadRef}`,
    input.quotationBreakdown
      ? `Quotation Breakdown:\n${input.quotationBreakdown}`
      : null,
    input.notes,
    `${input.appUrl}/leads/${input.leadId}`,
  ]
    .filter(Boolean)
    .join("\n");

  const end = new Date(
    input.scheduledAt.getTime() + input.durationMins * 60_000,
  );

  return {
    summary,
    ...(input.address ? { location: input.address } : {}),
    description,
    start: {
      dateTime: input.scheduledAt.toISOString(),
      timeZone: "Asia/Singapore",
    },
    end: { dateTime: end.toISOString(), timeZone: "Asia/Singapore" },
  };
}
