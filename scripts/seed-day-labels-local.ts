/**
 * Local-only day-counter / follow-up-label QA fixture; never imported by the
 * application and individually excluded from the application image via
 * .dockerignore.
 *
 * Seeds synthetic DAYLABEL-QA records covering:
 *   orders — payment-only clock, dispatched (since-PO) clock, completed order,
 *            missing milestone events, status rollback, repeated same-status
 *            note (must not reset the earliest-event clock), day-0 payment.
 *   leads  — every follow-up threshold (1/2/3/4/5), day-0 and future
 *            suppression, no attendance, non-completed appointment masking,
 *            Lost / Not Qualified / archived suppression behaviour.
 *
 * All inserts use fixed UUIDs + ON CONFLICT DO NOTHING, so reruns are safe and
 * existing rows (including tester edits elsewhere) are preserved.
 *
 * Usage:
 *   DATABASE_URL=postgresql://127.0.0.1:55439/drapeworks_priority_local \
 *     npx tsx scripts/seed-day-labels-local.ts
 */
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { DB, FulfilmentStatus } from "../src/lib/db/schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("Pass the isolated local DATABASE_URL explicitly");
}
const target = new URL(connectionString);
if (
  !["postgresql:", "postgres:"].includes(target.protocol) ||
  target.hostname !== "127.0.0.1" ||
  target.port !== "55439" ||
  target.pathname !== "/drapeworks_priority_local"
) {
  throw new Error("Refusing non-test destination");
}
const db = new Kysely<DB>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString, ssl: false, max: 1 }),
  }),
});

// Fixed hex UUIDs keep the fixture rerunnable without touching other records.
const id = (n: number) =>
  `dd110000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TESTER = "00000000-0000-4000-8000-000000000099";
const CUSTOMER_ID = id(1);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const daysAhead = (n: number) => new Date(Date.now() + n * 86_400_000);

type EventSpec = { status: FulfilmentStatus; at: Date; note: string };

async function seed() {
  await db.transaction().execute(async (trx) => {
    // BEFORE INSERT triggers (status transitions, display-id assignment,
    // lead-status derivation) fire BEFORE ON CONFLICT can skip a duplicate,
    // so conflicts alone are NOT idempotent here. Prefetch existing IDs once
    // per table and skip them entirely — no trigger ever sees the rerun rows.
    const existing = async (
      table: "customers" | "leads" | "appointments" | "orders" | "order_status_events",
      ids: string[],
    ) =>
      new Set(
        (
          await trx
            .selectFrom(table)
            .select("id")
            .where("id", "in", ids)
            .execute()
        ).map((row) => row.id),
      );

    // ── shared customer ────────────────────────────────────────────────
    if (!(await existing("customers", [CUSTOMER_ID])).has(CUSTOMER_ID)) {
      await trx
        .insertInto("customers")
        .values({ id: CUSTOMER_ID, name: "DAYLABEL-QA Fixture Customer", mobile: "90000001" })
        .execute();
    }

    // ── leads ──────────────────────────────────────────────────────────
    const leads: { key: number; ref: string; name: string }[] = [
      { key: 101, ref: "DAYLABEL-QA-L01", name: "DAYLABEL-QA fu1 (2d ago)" },
      { key: 102, ref: "DAYLABEL-QA-L02", name: "DAYLABEL-QA fu2 (5d ago)" },
      { key: 103, ref: "DAYLABEL-QA-L03", name: "DAYLABEL-QA fu3 (10d ago)" },
      { key: 104, ref: "DAYLABEL-QA-L04", name: "DAYLABEL-QA fu4 (20d ago)" },
      { key: 105, ref: "DAYLABEL-QA-L05", name: "DAYLABEL-QA fu5 (40d ago)" },
      { key: 106, ref: "DAYLABEL-QA-L06", name: "DAYLABEL-QA day0 (today)" },
      { key: 107, ref: "DAYLABEL-QA-L07", name: "DAYLABEL-QA future (+3d)" },
      { key: 108, ref: "DAYLABEL-QA-L08", name: "DAYLABEL-QA no appointment" },
      { key: 109, ref: "DAYLABEL-QA-L09", name: "DAYLABEL-QA masked (10d + later scheduled)" },
      { key: 110, ref: "DAYLABEL-QA-L10", name: "DAYLABEL-QA Lost (suppressed)" },
      { key: 111, ref: "DAYLABEL-QA-L11", name: "DAYLABEL-QA Not Qualified (labelled)" },
      { key: 112, ref: "DAYLABEL-QA-L12", name: "DAYLABEL-QA archived (suppressed)" },
      { key: 113, ref: "DAYLABEL-QA-L13", name: "DAYLABEL-QA Won (suppressed)" },
    ];
    const existingLeads = await existing("leads", leads.map((lead) => id(lead.key)));
    for (const lead of leads.filter((lead) => !existingLeads.has(id(lead.key)))) {
      await trx
        .insertInto("leads")
        .values({
          id: id(lead.key),
          lead_ref: lead.ref,
          name: lead.name,
          mobile: "90000002",
          contact_channel: "Telegram",
          source: "Other",
          inbound_outbound: "Inbound",
          primary_product: "Curtains",
          funnel_stage: "Send Quotation",
          lead_status: "Active",
          owner_id: TESTER,
          assigned_consultant_id: TESTER,
          first_initiated_at: daysAgo(60),
        })
        .onConflict((oc) => oc.column("id").doNothing())
        .execute();
    }

    // ── appointments (attended = status 'completed') ───────────────────
    const attended: { key: number; leadKey: number; at: Date }[] = [
      { key: 201, leadKey: 101, at: daysAgo(2) },
      { key: 202, leadKey: 102, at: daysAgo(5) },
      { key: 203, leadKey: 103, at: daysAgo(10) },
      { key: 204, leadKey: 104, at: daysAgo(20) },
      { key: 205, leadKey: 105, at: daysAgo(40) },
      { key: 206, leadKey: 106, at: new Date() },
      { key: 207, leadKey: 107, at: daysAhead(3) },
      { key: 209, leadKey: 109, at: daysAgo(10) },
      { key: 210, leadKey: 110, at: daysAgo(10) },
      { key: 211, leadKey: 111, at: daysAgo(10) },
      { key: 212, leadKey: 112, at: daysAgo(10) },
      { key: 213, leadKey: 113, at: daysAgo(10) },
    ];
    const existingAppointments = await existing(
      "appointments",
      [...attended.map((appt) => appt.key), 220].map(id),
    );
    for (const appt of attended.filter((appt) => !existingAppointments.has(id(appt.key)))) {
      await trx
        .insertInto("appointments")
        .values({
          id: id(appt.key),
          customer_id: CUSTOMER_ID,
          lead_id: id(appt.leadKey),
          scheduled_at: appt.at,
          status: "completed",
          development: "DAYLABEL-QA Residences",
        })
        .onConflict((oc) => oc.column("id").doNothing())
        .execute();
    }
    // A later NON-completed appointment must not mask the attended one.
    if (!existingAppointments.has(id(220))) {
      await trx
        .insertInto("appointments")
        .values({
          id: id(220),
          customer_id: CUSTOMER_ID,
          lead_id: id(109),
          scheduled_at: daysAhead(5),
          status: "scheduled",
          development: "DAYLABEL-QA Residences",
        })
        .execute();
    }

    // Suppression / labelling stages applied AFTER the appointment inserts so
    // appointment triggers cannot overwrite them.
    await trx
      .updateTable("leads")
      .set({ funnel_stage: "Lost", closure_reason: "Other" })
      .where("id", "=", id(110))
      .execute();
    await trx
      .updateTable("leads")
      .set({ funnel_stage: "Not Qualified", closure_reason: "Other" })
      .where("id", "=", id(111))
      .execute();
    await trx
      .updateTable("leads")
      .set({ is_archived: true })
      .where("id", "=", id(112))
      .execute();
    await trx
      .updateTable("leads")
      .set({ funnel_stage: "Won", closure_reason: "Other" })
      .where("id", "=", id(113))
      .execute();

    // ── orders ─────────────────────────────────────────────────────────
    const orders: { key: number; note: string }[] = [
      { key: 301, note: "payment only → since-payment clock" },
      { key: 302, note: "dispatched → since-PO clock" },
      { key: 303, note: "completed → retains since-PO clock" },
      { key: 304, note: "no events → no counter" },
      { key: 305, note: "reverted below milestone → counter hidden" },
      { key: 306, note: "repeated same-status note → earliest wins" },
      { key: 307, note: "payment today → 0 days" },
      { key: 308, note: "status ahead of events → no counter" },
    ];
    const existingOrders = await existing("orders", orders.map((order) => id(order.key)));
    for (const order of orders.filter((order) => !existingOrders.has(id(order.key)))) {
      await trx
        .insertInto("orders")
        .values({
          id: id(order.key),
          customer_id: CUSTOMER_ID,
          consultant_id: TESTER,
          development: "DAYLABEL-QA Residences",
          general_notes: `DAYLABEL-QA: ${order.note}`,
          is_draft: false,
          // display_id / seq_year / seq_num are filled by the assign trigger.
          display_id: "",
          seq_year: 0,
          seq_num: 0,
        })
        .onConflict((oc) => oc.column("id").doNothing())
        .execute();
    }

    // ── status events (each insert drives orders.current_status) ────────
    const events: { key: number; orderKey: number; status: FulfilmentStatus; at: Date; note: string }[] = [];
    let eventKey = 400;
    const push = (orderKey: number, specs: EventSpec[]) => {
      for (const spec of specs) events.push({ key: eventKey++, orderKey, ...spec });
    };

    // 301: payment 6d ago → "6 days since payment"
    push(301, [
      { status: "order_recorded", at: daysAgo(8), note: "DAYLABEL-QA" },
      { status: "quotation_sent", at: daysAgo(7), note: "DAYLABEL-QA" },
      { status: "deposit_received", at: daysAgo(6), note: "DAYLABEL-QA" },
    ]);
    // 302: sent to vendor 4d ago → "4 days since PO sent"
    push(302, [
      { status: "order_recorded", at: daysAgo(14), note: "DAYLABEL-QA" },
      { status: "quotation_sent", at: daysAgo(13), note: "DAYLABEL-QA" },
      { status: "deposit_received", at: daysAgo(12), note: "DAYLABEL-QA" },
      { status: "po_ready", at: daysAgo(5), note: "DAYLABEL-QA" },
      { status: "sent_to_vendor", at: daysAgo(4), note: "DAYLABEL-QA" },
    ]);
    // 303: completed, PO sent 30d ago → "30 days since PO sent"
    push(303, [
      { status: "order_recorded", at: daysAgo(45), note: "DAYLABEL-QA" },
      { status: "quotation_sent", at: daysAgo(40), note: "DAYLABEL-QA" },
      { status: "deposit_received", at: daysAgo(38), note: "DAYLABEL-QA" },
      { status: "po_ready", at: daysAgo(32), note: "DAYLABEL-QA" },
      { status: "sent_to_vendor", at: daysAgo(30), note: "DAYLABEL-QA" },
      { status: "sent_logistic", at: daysAgo(28), note: "DAYLABEL-QA" },
      { status: "shipping_sg", at: daysAgo(20), note: "DAYLABEL-QA" },
      { status: "delivered_checked", at: daysAgo(14), note: "DAYLABEL-QA" },
      { status: "fulfilment", at: daysAgo(10), note: "DAYLABEL-QA" },
      { status: "installation_completed", at: daysAgo(7), note: "DAYLABEL-QA" },
      { status: "completed", at: daysAgo(5), note: "DAYLABEL-QA" },
    ]);
    // 305: reached sent_to_vendor, then admin-reverted to quotation_sent → hidden
    push(305, [
      { status: "order_recorded", at: daysAgo(12), note: "DAYLABEL-QA" },
      { status: "quotation_sent", at: daysAgo(11), note: "DAYLABEL-QA" },
      { status: "deposit_received", at: daysAgo(10), note: "DAYLABEL-QA" },
      { status: "po_ready", at: daysAgo(9), note: "DAYLABEL-QA" },
      { status: "sent_to_vendor", at: daysAgo(8), note: "DAYLABEL-QA" },
      { status: "po_ready", at: daysAgo(7), note: "DAYLABEL-QA revert" },
      { status: "deposit_received", at: daysAgo(6), note: "DAYLABEL-QA revert" },
      { status: "quotation_sent", at: daysAgo(5), note: "DAYLABEL-QA revert" },
    ]);
    // 306: first send 10d ago + repeated same-status note 1d ago → "10 days since PO sent"
    push(306, [
      { status: "order_recorded", at: daysAgo(15), note: "DAYLABEL-QA" },
      { status: "quotation_sent", at: daysAgo(14), note: "DAYLABEL-QA" },
      { status: "deposit_received", at: daysAgo(13), note: "DAYLABEL-QA" },
      { status: "po_ready", at: daysAgo(11), note: "DAYLABEL-QA" },
      { status: "sent_to_vendor", at: daysAgo(10), note: "DAYLABEL-QA first send" },
      { status: "sent_to_vendor", at: daysAgo(1), note: "DAYLABEL-QA amendment note — must not reset" },
    ]);
    // 307: deposit today → "0 days since payment"
    push(307, [
      { status: "order_recorded", at: daysAgo(3), note: "DAYLABEL-QA" },
      { status: "quotation_sent", at: daysAgo(2), note: "DAYLABEL-QA" },
      { status: "deposit_received", at: new Date(), note: "DAYLABEL-QA" },
    ]);
    // 308: deposit event only, then current_status forced ahead of the events.
    push(308, [
      { status: "order_recorded", at: daysAgo(9), note: "DAYLABEL-QA" },
      { status: "quotation_sent", at: daysAgo(8), note: "DAYLABEL-QA" },
      { status: "deposit_received", at: daysAgo(7), note: "DAYLABEL-QA" },
    ]);
    // Filter BEFORE insert: the validate_status_transition trigger raises on
    // any event that is not ±1 from the order's current status, so a rerun
    // must never let it see an already-seeded event.
    const existingEvents = await existing(
      "order_status_events",
      events.map((event) => id(event.key)),
    );
    for (const event of events.filter((event) => !existingEvents.has(id(event.key)))) {
      await trx
        .insertInto("order_status_events")
        .values({
          id: id(event.key),
          order_id: id(event.orderKey),
          status: event.status,
          note: event.note,
          created_at: event.at,
        })
        .execute();
    }
    // Status ahead of its events: no sent_to_vendor row exists → no counter.
    await trx
      .updateTable("orders")
      .set({ current_status: "sent_to_vendor" })
      .where("id", "=", id(308))
      .execute();
  });

  const report = [
    "",
    "DAYLABEL-QA fixture seeded. Expected rendered labels:",
    "  orders:",
    `    ${id(301)} → "6 days since payment"`,
    `    ${id(302)} → "4 days since PO sent"`,
    `    ${id(303)} → "30 days since PO sent" (completed)`,
    `    ${id(304)} → no counter (no events)`,
    `    ${id(305)} → no counter (reverted to quotation_sent)`,
    `    ${id(306)} → "10 days since PO sent" (repeat note must not reset)`,
    `    ${id(307)} → "0 days since payment"`,
    `    ${id(308)} → no counter (status ahead of events)`,
    "  leads:",
    `    DAYLABEL-QA-L01 ${id(101)} → "Follow-up 1 due"`,
    `    DAYLABEL-QA-L02 ${id(102)} → "Follow-up 2 due"`,
    `    DAYLABEL-QA-L03 ${id(103)} → "Follow-up 3 due"`,
    `    DAYLABEL-QA-L04 ${id(104)} → "Follow-up 4 due"`,
    `    DAYLABEL-QA-L05 ${id(105)} → "Follow-up 5 due"`,
    `    DAYLABEL-QA-L06 ${id(106)} → no label (day 0)`,
    `    DAYLABEL-QA-L07 ${id(107)} → no label (future-dated)`,
    `    DAYLABEL-QA-L08 ${id(108)} → no label (no appointment)`,
    `    DAYLABEL-QA-L09 ${id(109)} → "Follow-up 3 due" (later scheduled appt must not mask)`,
    `    DAYLABEL-QA-L10 ${id(110)} → no label (Lost)`,
    `    DAYLABEL-QA-L11 ${id(111)} → "Follow-up 3 due" (Not Qualified stays labelled)`,
    `    DAYLABEL-QA-L12 ${id(112)} → no label (archived)`,
    `    DAYLABEL-QA-L13 ${id(113)} → no label (Won)`,
  ];
  console.log(report.join("\n"));
}

seed()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Seed failed");
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
