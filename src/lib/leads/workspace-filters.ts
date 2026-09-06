import { CONTACT_CHANNELS, FUNNEL_STAGES, LEAD_DIRECTIONS, LEAD_OUTCOMES, LEAD_SOURCES, LEAD_STATUSES, PRIMARY_PRODUCTS } from "./funnel-types";

export const ACTIVE_QUEUE_EXCLUDED_STAGES = ["Won", "Lost", "Not Qualified"] as const;
export const ACTIVE_QUEUE_STAGE_PRESET = `All except ${ACTIVE_QUEUE_EXCLUDED_STAGES.join(", ")}`;

export const ACTION_FILTERS = ["Reply Required", "Follow-Up", "Awaiting Customer", "Resolve Appointment Barrier", "Book Appointment", "Confirm / Attend Appointment", "Send Quotation", "Push for Deposit", "Push for Decision", "Resolve Closing Barrier", "Nurture Lead", "Activate Lead", "Qualify Lead", "Closed", "Won"] as const;
export const DUE_FILTERS = ["Overdue", "Due Today", "Upcoming", "No Date", "Closed"] as const;
export const FILTER_SELECTS = [
  { key: "direction", label: "Inbound / Outbound", values: LEAD_DIRECTIONS },
  { key: "stage", label: "Funnel Stage", values: FUNNEL_STAGES },
  { key: "status", label: "Lead Status", values: LEAD_STATUSES },
  { key: "outcome", label: "Last Contact Outcome", values: LEAD_OUTCOMES },
  { key: "action", label: "Action Required", values: ACTION_FILTERS },
  { key: "due", label: "Due Status", values: DUE_FILTERS },
  { key: "channel", label: "Contact Channel", values: CONTACT_CHANNELS },
  { key: "source", label: "Lead Source", values: LEAD_SOURCES },
  { key: "product", label: "Product", values: PRIMARY_PRODUCTS },
] as const;
export const FILTER_DATES = [
  { key: "created", label: "Created Date" },
  { key: "initiated", label: "Initiated Date" },
  { key: "contact", label: "Last Contact Date" },
  { key: "next", label: "Next Action Date" },
] as const;
export const validFilterDate = (value: string | undefined): value is string => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
export function selectedFilterValues(value: string | undefined, allowed: readonly string[]) {
  if (!value) return [];
  return [...new Set(value.split(",").map(item => item.trim()).filter(item => allowed.includes(item)))];
}
export function selectedFilters(params: Record<string, string | undefined>, owners: { id: string; full_name: string | null }[]) {
  const selected: { key: string; label: string }[] = [];
  for (const field of FILTER_SELECTS) {
    const values = selectedFilterValues(params[field.key], field.values as readonly string[]);
    if (values.length) selected.push({ key: field.key, label: `${field.label}: ${values.join(", ")}` });
  }
  for (const field of FILTER_DATES) for (const bound of ["from", "to"]) {
    const key = `${field.key}_${bound}`;
    if (validFilterDate(params[key])) selected.push({ key, label: `${field.label} ${bound}: ${params[key]}` });
  }
  if (params.q?.trim()) selected.push({ key: "q", label: `Search: ${params.q.trim()}` });
  if (params.detail?.trim()) selected.push({ key: "detail", label: `Action Detail: ${params.detail.trim()}` });
  if (params.owner === "unassigned") selected.push({ key: "owner", label: "Owner: Unassigned" });
  else {
    const owner = owners.find(person => person.id === params.owner);
    if (owner) selected.push({ key: "owner", label: `Owner: ${owner.full_name ?? "Unnamed"}` });
  }
  if (params.needs_owner === "1") selected.push({ key: "needs_owner", label: "Needs owner" });
  if (params.needs_review === "1") selected.push({ key: "needs_review", label: "Needs review" });
  return selected;
}

export function columnFilterPills(params: Record<string, string | undefined>, owners: { id: string; full_name: string | null }[], view: "all" | "work") {
  const selected = selectedFilters(params, owners);
  const columns = [
    ["q", "Customer Name"], ["created", "Created Date"], ["direction", "Inbound / Outbound"],
    ["initiated", "Initiated Date"], ["contact", "Last Contact Date"], ["stage", "Funnel Stage"],
    ["status", "Lead Status"], ["outcome", "Last Contact Outcome"], ["action", "Action Required"],
    ["detail", "Action Detail"], ["next", "Next Action Date"], ["due", "Due Status"],
  ];
  const pills = columns.map(([key, label]) => {
    const matches = selected.filter(item => item.key === key || item.key === `${key}_from` || item.key === `${key}_to`);
    const range = FILTER_DATES.some(field => field.key === key);
    const value = range && matches.length ? `${validFilterDate(params[`${key}_from`]) ? params[`${key}_from`] : "Any"} – ${validFilterDate(params[`${key}_to`]) ? params[`${key}_to`] : "Any"}` : matches.length ? selectedFilterValues(params[key], FILTER_SELECTS.find(field => field.key === key)?.values ?? []).join(", ") : "All";
    const stagePreset = key === "stage" && view === "work" && !matches.length;
    return { key, label, value: stagePreset ? ACTIVE_QUEUE_STAGE_PRESET : value, keys: matches.map(item => item.key), preset: stagePreset };
  });
  for (const item of selected.filter(item => !pills.some(pill => pill.keys.includes(item.key)))) {
    const [label, ...value] = item.label.split(": ");
    pills.push({ key: item.key, label, value: value.join(": ") || "Yes", keys: [item.key], preset: false });
  }
  return pills;
}
