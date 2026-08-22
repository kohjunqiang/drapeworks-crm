"use server";

import "server-only";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/require-role";
import { syncAppointment, unsyncAppointment } from "@/lib/calendar/sync";
import { db } from "@/lib/db/kysely";
import {
  appointmentCreateSchema,
  appointmentRescheduleSchema,
  appointmentStatusSchema,
} from "@/lib/validation/appointment";

/** '2026-08-25' + '14:30' in Singapore (UTC+8, no DST) as a real instant. */
function sgInstant(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+08:00`);
}

export async function bookAppointment(input: unknown): Promise<void> {
  const session = await requireRole(["consultant", "admin"]);
  const parsed = appointmentCreateSchema.parse(input);

  const appointmentId = await db.transaction().execute(async (trx) => {
    // Read before the update overwrites it. This is the only record of where
    // the lead was, and cancelling needs it to put the lead back rather than
    // guess a stage it may never have occupied.
    const before = await trx
      .selectFrom("leads")
      .select(["funnel_stage", "last_outcome", "action_date"])
      .where("id", "=", parsed.lead_id)
      .executeTakeFirstOrThrow();

    const customerId =
      parsed.customer.mode === "existing"
        ? parsed.customer.customer_id
        : (
            await trx
              .insertInto("customers")
              .values({
                name: parsed.customer.name,
                mobile: parsed.customer.mobile,
                email: parsed.customer.email || null,
                created_by: session.user.id,
              })
              .returning("id")
              .executeTakeFirstOrThrow()
          ).id;

    const appointment = await trx
      .insertInto("appointments")
      .values({
        lead_id: parsed.lead_id,
        customer_id: customerId,
        scheduled_at: sgInstant(parsed.date, parsed.time),
        duration_mins: parsed.duration_mins,
        development: parsed.development ?? null,
        address: parsed.address ?? null,
        notes: parsed.notes ?? null,
        status: "scheduled",
        lead_stage_before: before.funnel_stage,
        lead_outcome_before: before.last_outcome,
        lead_action_date_before: before.action_date,
        google_sync_state: "pending",
        created_by: session.user.id,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    // The lead is now a customer, and the funnel advances. Both fields move
    // together so the engine's cascade sees a consistent lead.
    await trx
      .updateTable("leads")
      .set({
        customer_id: customerId,
        funnel_stage: "Appointment Booked",
        last_outcome: "Appointment Booked",
        action_date: parsed.date,
        updated_at: new Date(),
      })
      .where("id", "=", parsed.lead_id)
      .execute();

    return appointment.id;
  });

  // Outside the transaction, deliberately. The booking is already durable; a
  // Google outage downgrades this to a retry, it does not roll anything back.
  await syncAppointment(appointmentId);

  revalidatePath("/leads");
  revalidatePath(`/leads/${parsed.lead_id}`);
}

export async function rescheduleAppointment(input: unknown): Promise<void> {
  await requireRole(["consultant", "admin"]);
  const parsed = appointmentRescheduleSchema.parse(input);

  const updated = await db
    .updateTable("appointments")
    .set({
      scheduled_at: sgInstant(parsed.date, parsed.time),
      duration_mins: parsed.duration_mins,
      updated_at: new Date(),
    })
    .where("id", "=", parsed.id)
    .returning("lead_id")
    .executeTakeFirstOrThrow();

  // Booking wrote action_date; a reschedule that leaves it behind means the
  // queue keeps showing the old appointment date and the lead lands in the
  // wrong priority band.
  await db
    .updateTable("leads")
    .set({ action_date: parsed.date, updated_at: new Date() })
    .where("id", "=", updated.lead_id)
    .execute();

  // Patches the existing event rather than creating a second one.
  await syncAppointment(parsed.id);

  revalidatePath("/leads");
  revalidatePath(`/leads/${updated.lead_id}`);
}

export async function setAppointmentStatus(input: unknown): Promise<void> {
  await requireRole(["consultant", "admin"]);
  const parsed = appointmentStatusSchema.parse(input);

  // Only a scheduled appointment may transition, and the guard lives in the
  // WHERE clause so the check and the write are one atomic statement — two
  // concurrent requests cannot both read 'scheduled' and both win.
  //
  // The UI already hides the status controls unless status === 'scheduled',
  // but that only protects a freshly rendered page. The case that gets through
  // is a stale tab: a consultant cancels on their phone, then clicks "Mark
  // completed" in a laptop tab opened before the cancel. Without this the
  // completed branch would fire on top of an already-restored lead and push it
  // to 'Post-Appointment / Quote Pending' for an appointment that never
  // happened. The client is not the enforcement surface (rules/data/rls.md).
  const updated = await db
    .updateTable("appointments")
    .set({ status: parsed.status, updated_at: new Date() })
    .where("id", "=", parsed.id)
    .where("status", "=", "scheduled")
    .returning([
      "lead_id",
      "lead_stage_before",
      "lead_outcome_before",
      "lead_action_date_before",
    ])
    .executeTakeFirst();

  // Zero rows means the appointment already left 'scheduled' (or does not
  // exist). Throwing rather than returning quietly keeps the UI from reporting
  // a change that never happened — the house signal for a refused write
  // (see requoteOrder's locked-order guard in actions/orders.ts).
  if (!updated) {
    throw new Error(
      "This appointment is no longer scheduled — someone may have already updated it. Reload the page to see its current status.",
    );
  }

  if (parsed.status === "cancelled" || parsed.status === "no_show") {
    await unsyncAppointment(parsed.id);

    // Without this the lead stays at 'Appointment Booked', so the engine
    // derives 'Attend / Confirm Appointment' — Contact Today — forever, for an
    // appointment that is not happening.
    //
    // Restore ALL THREE recorded values. Restoring the stage while writing a
    // fresh outcome would be inert: outcome branches 3-8 sit above every stage
    // branch, so 'Ready to Book Appointment' would fire branch 7 and every
    // cancelled lead would derive 'Book Appointment' regardless of where it
    // came from. The restored stage would move the chip on screen and nothing
    // else — not the action, not the priority, not queue placement.
    //
    // The 'completed' path below gets away with setting an outcome only
    // because 'Appointment Completed' matches no outcome branch and falls
    // through to the stage.
    //
    // action_date is restored too, not cleared. Booking overwrote it with the
    // appointment date; clearing it on cancel would drop a Nurture lead's
    // future follow-up date, taking its due status from Upcoming to Schedule
    // Date and — where the band is date-derived rather than action-derived —
    // moving its priority as well. 53 leads carry one today.
    //
    // All three columns are nullable, and outcome/date are legitimately null
    // for a lead that had neither before booking. The stage fallback is
    // belt-and-braces only: the column ships in the same migration as the
    // table, so no appointment can exist without it.
    await db
      .updateTable("leads")
      .set({
        funnel_stage: updated.lead_stage_before ?? "Qualified / Pre-Appointment",
        last_outcome: updated.lead_outcome_before,
        action_date: updated.lead_action_date_before,
        updated_at: new Date(),
      })
      .where("id", "=", updated.lead_id)
      .execute();
  }

  if (parsed.status === "completed") {
    await db
      .updateTable("leads")
      .set({
        funnel_stage: "Post-Appointment / Quote Pending",
        last_outcome: "Appointment Completed",
        // Send Quote defaults its own effective date to today; a stale
        // action_date from the booking would override it.
        action_date: null,
        updated_at: new Date(),
      })
      .where("id", "=", updated.lead_id)
      .execute();
  }

  revalidatePath("/leads");
  revalidatePath(`/leads/${updated.lead_id}`);
}

/** Backs the "Calendar sync failed — Retry" affordance. */
export async function retryAppointmentSync(
  appointmentId: string,
): Promise<void> {
  await requireRole(["consultant", "admin"]);
  await syncAppointment(appointmentId);

  const row = await db
    .selectFrom("appointments")
    .select("lead_id")
    .where("id", "=", appointmentId)
    .executeTakeFirstOrThrow();
  revalidatePath(`/leads/${row.lead_id}`);
}
