"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireRole, requireSession } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";
import type { FulfilmentStatus } from "@/lib/db/schema";
import { normalizeFreightNumber } from "@/lib/logistics/freight";
import { loadOrderShipmentState } from "@/lib/logistics/load";
import { reconcileFulfilmentStatus } from "@/lib/logistics/reconcile";
import { ensureZohoInvoiceForOrder } from "@/lib/actions/quotations";
import {
  requiresLocalDelivery,
  SHIPMENT_CATEGORIES,
  validateAllShipmentsArrived,
  validateShipmentNumbersForTransition,
} from "@/lib/logistics/shipments";
import {
  STATUS_FLOW,
  leadMilestoneForOrderStatus,
  leadStateForRevertedOrderStatus,
} from "@/lib/status-flow";
import { actionErrorMessage, UserFacingError } from "@/lib/user-facing-error";

const advanceSchema = z.object({
  orderId: z.string().uuid(),
  expectedStatus: z.custom<FulfilmentStatus>(
    (value) =>
      typeof value === "string" &&
      STATUS_FLOW.includes(value as FulfilmentStatus),
    "Order status invalid",
  ),
  note: z.string().max(2000).optional(),
  balanceReceivedConfirmed: z.boolean().optional(),
  shipmentNumbers: z.array(z.object({
    category: z.enum(SHIPMENT_CATEGORIES),
    localDeliveryNumber: z.string().trim().max(200).optional(),
    overseasFreightNumber: z.string().trim().min(1).max(200).optional(),
  })).max(SHIPMENT_CATEGORIES.length).optional(),
});

export async function advanceOrderStatus(input: unknown) {
  const session = await requireRole(["ops", "admin"]);
  const parsed = advanceSchema.parse(input);

  if (parsed.expectedStatus === "order_recorded") {
    throw new UserFacingError("Create, preview, and confirm the official quotation from the quotation workspace.");
  }

  // Creating the invoice and applying its deposit are external side effects, so they must not happen
  // while a Postgres row lock is held. The helper reconciles an invoice already
  // linked by Zoho before creating one, making a retry safe if the later local
  // status transaction loses a race or fails.
  if (parsed.expectedStatus === "quotation_sent") {
    await ensureZohoInvoiceForOrder(parsed.orderId);
  }

  const linkedLeadId = await db.transaction().execute(async (trx) => {
    const order = await trx
      .selectFrom("orders")
      .select(["current_status", "appointment_id", "lead_id", "is_draft"])
      .where("id", "=", parsed.orderId)
      .forUpdate()
      .executeTakeFirst();
    if (!order) throw new UserFacingError("Order not found");
    if (order.is_draft) {
      throw new UserFacingError(
        "Finish the consultation before advancing this order",
      );
    }
    if (order.current_status !== parsed.expectedStatus) {
      throw new UserFacingError("Order status already changed. Refresh and try again.");
    }
    if (order.current_status === "installation_completed" && parsed.balanceReceivedConfirmed !== true) {
      throw new UserFacingError("Confirm that the remaining balance has been received before completing this order.");
    }
    if (parsed.expectedStatus === "quotation_sent") {
      const quotation = await trx.selectFrom("order_quotations").select(["status", "zoho_invoice_id", "zoho_payment_id"]).where("order_id", "=", parsed.orderId).where("superseded_at", "is", null).forUpdate().executeTakeFirst();
      if (quotation && (quotation.status !== "sent" || !quotation.zoho_invoice_id || !quotation.zoho_payment_id)) {
        throw new UserFacingError("The current sent quotation must own the Zoho invoice and matching deposit payment before the deposit can be recorded");
      }
    }

    const idx = STATUS_FLOW.indexOf(order.current_status);
    if (idx === -1) throw new UserFacingError("Order status invalid");
    if (idx === STATUS_FLOW.length - 1) throw new UserFacingError("Already completed");
    if (order.current_status === "delivered_checked") {
      const arrangement = await trx
        .selectFrom("fulfilment_arrangements")
        .select("id")
        .where("order_id", "=", parsed.orderId)
        .where("cancelled_at", "is", null)
        .executeTakeFirst();
      if (!arrangement) {
        throw new UserFacingError(
          "Arrange the installation date before moving to Fulfillment Arrangement",
        );
      }
    }

    const next = STATUS_FLOW[idx + 1];
    const fallbackLeadId = !order.lead_id && order.appointment_id
      ? (
          await trx
            .selectFrom("appointments")
            .select("lead_id")
            .where("id", "=", order.appointment_id)
            .executeTakeFirst()
        )?.lead_id
      : undefined;
    const leadId = order.lead_id ?? fallbackLeadId;
    const linkedLead = leadId
      ? await trx
          .selectFrom("leads")
          .select(["id", "funnel_stage"])
          .where("id", "=", leadId)
          .forUpdate()
          .executeTakeFirst()
      : undefined;

    const trackingMode = order.current_status === "sent_to_vendor"
      ? "local" as const
      : order.current_status === "sent_logistic"
        ? "overseas" as const
        : null;
    let directOnlyLocalTransition = false;
    if (trackingMode) {
      const state = await loadOrderShipmentState(trx, parsed.orderId);
      directOnlyLocalTransition = trackingMode === "local" &&
        !state.shipments.some((shipment) =>
          requiresLocalDelivery(shipment.category));
      const submittedNumbers = parsed.shipmentNumbers?.map((number) => ({
        ...(state.shipments.find((row) => row.category === number.category) ?? {
          arrivedCheckedAt: null,
          arrivalNote: null,
          legacyLocalDeliveryNumber: null,
          legacyOverseasFreightNumber: null,
          source: "derived" as const,
          updatedAt: new Date(0),
        }),
        category: number.category,
        localDeliveryNumber: number.localDeliveryNumber ?? null,
        overseasFreightNumber: number.overseasFreightNumber ?? null,
        source: "derived" as const,
      }));
      const numbers = submittedNumbers ?? state.shipments;
      const validationError = validateShipmentNumbersForTransition(
        state.categories,
        numbers,
        trackingMode,
      );
      if (validationError) throw new UserFacingError(validationError);
      // A checked arrival certifies the tracking numbers recorded against it.
      // A stale dialog must never clear or replace them — refresh for the
      // recorded values, or reopen the arrival check first.
      for (const number of submittedNumbers ?? []) {
        const existing = state.shipments.find(
          (shipment) => shipment.category === number.category,
        );
        if (!existing?.arrivedCheckedAt || existing.notNeeded) continue;
        const localChanged =
          requiresLocalDelivery(number.category) &&
          number.localDeliveryNumber !== existing.localDeliveryNumber;
        const overseasChanged =
          trackingMode === "overseas" &&
          normalizeFreightNumber(number.overseasFreightNumber ?? "") !==
            normalizeFreightNumber(existing.overseasFreightNumber ?? "");
        if (localChanged || overseasChanged) {
          throw new UserFacingError(
            `${number.category} is already arrived and checked — refresh the order for its recorded numbers, or reopen the arrival before changing them.`,
          );
        }
      }
      for (const number of submittedNumbers ?? []) {
        const existing = state.shipments.find(
          (shipment) => shipment.category === number.category,
        );
        if (existing?.notNeeded) continue;
        if (
          trackingMode === "local" &&
          !requiresLocalDelivery(number.category)
        ) continue;
        // Nothing new is ever recorded on a checked arrival — skipping also
        // leaves its source and updated_at untouched.
        if (existing?.arrivedCheckedAt) continue;
        const values = {
          order_id: parsed.orderId,
          category: number.category,
          local_delivery_number: requiresLocalDelivery(number.category)
            ? number.localDeliveryNumber ?? null
            : existing?.localDeliveryNumber ?? null,
          overseas_freight_number: trackingMode === "overseas"
            ? number.overseasFreightNumber
            : null,
          source: "derived" as const,
        };
        await trx.insertInto("order_shipments")
          .values(values)
          .onConflict((conflict) => conflict
            .columns(["order_id", "category"])
            .doUpdateSet({
              ...(requiresLocalDelivery(number.category)
                ? { local_delivery_number: number.localDeliveryNumber }
                : {}),
              ...(trackingMode === "overseas"
                ? { overseas_freight_number: number.overseasFreightNumber }
                : {}),
              source: "derived" as const,
            }))
          .execute();
      }
    } else if (parsed.shipmentNumbers?.length) {
      throw new UserFacingError("Delivery numbers are not recorded at this stage.");
    }

    if (order.current_status === "shipping_sg") {
      const state = await loadOrderShipmentState(trx, parsed.orderId);
      const numberError = validateShipmentNumbersForTransition(
        state.categories,
        state.shipments,
        "overseas",
      );
      if (numberError) throw new UserFacingError(numberError);
      const arrivalError = validateAllShipmentsArrived(
        state.categories,
        state.shipments,
      );
      if (arrivalError) throw new UserFacingError(arrivalError);
    }

    await trx.insertInto("order_status_events").values({
      order_id: parsed.orderId,
      status: next,
      note: next === "completed"
        ? ["Confirmed remaining balance received in full.", parsed.note?.trim()].filter(Boolean).join("\n\n")
        : parsed.note?.trim() || (
        directOnlyLocalTransition
          ? "Not applicable — shipments sent directly"
          : null
      ),
      created_by: session.user.id,
    }).execute();
    const milestone = leadMilestoneForOrderStatus(next);
    if (linkedLead && milestone) {
      await trx.updateTable("leads").set({
        funnel_stage: milestone.stage,
        last_outcome: milestone.outcome,
        ...(next === "quotation_sent" ? { quotation_sent_at: new Date() } : {}),
        updated_at: new Date(),
      }).where("id", "=", linkedLead.id).execute();
      if (linkedLead.funnel_stage !== milestone.stage) {
        await trx.insertInto("lead_stage_events").values({
          lead_id: linkedLead.id,
          from_stage: linkedLead.funnel_stage,
          to_stage: milestone.stage,
          changed_at: new Date(),
          changed_by: session.user.id,
          source: "system",
        }).execute();
      }
    }
    // When the manifest already shows every required shipment arrived (and an
    // installation is booked), one manual advance finishes the catch-up rather
    // than making the operator click through stale milestones.
    await reconcileFulfilmentStatus(trx, {
      orderId: parsed.orderId,
      createdBy: session.user.id,
    });
    return linkedLead?.id ?? null;
  });

  revalidatePath(`/orders/${parsed.orderId}`);
  revalidatePath("/orders");
  if (linkedLeadId) {
    revalidatePath("/leads");
    revalidatePath(`/leads/${linkedLeadId}`);
  }
}

// Server Action errors are redacted to a digest in production, so the advance
// dialog cannot catch a thrown message. This wrapper returns the deliberate
// user-facing message instead; anything unexpected is logged and genericised.
export async function advanceOrderStatusUi(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await advanceOrderStatus(input);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error, "The order status could not be updated. Refresh and try again.") };
  }
}

const noteSchema = z.object({
  orderId: z.string().uuid(),
  note: z.string().min(1, "Note required").max(2000),
});

export async function addStatusNote(input: unknown) {
  const session = await requireSession();
  const parsed = noteSchema.parse(input);

  await db.transaction().execute(async (trx) => {
    const order = await trx
      .selectFrom("orders")
      .select(["current_status", "consultant_id"])
      .where("id", "=", parsed.orderId)
      .forUpdate()
      .executeTakeFirst();
    if (!order) throw new Error("Order not found");

    const role = session.profile.role;
    const isOwner = order.consultant_id === session.user.id;
    if (!(role === "ops" || role === "admin" || (role === "consultant" && isOwner))) {
      throw new Error("Forbidden");
    }

    await trx.insertInto("order_status_events").values({
      order_id: parsed.orderId,
      status: order.current_status,
      note: parsed.note.trim(),
      created_by: session.user.id,
    }).execute();
  });

  revalidatePath(`/orders/${parsed.orderId}`);
}

const revertSchema = z.object({
  orderId: z.string().uuid(),
  expectedStatus: z.custom<FulfilmentStatus>(
    (value) =>
      typeof value === "string" &&
      STATUS_FLOW.includes(value as FulfilmentStatus),
    "Order status invalid",
  ),
  reason: z.string().min(1, "Reason required").max(2000),
});

export async function revertOrderStatus(input: unknown) {
  const session = await requireRole(["admin"]);
  const parsed = revertSchema.parse(input);

  const linkedLeadId = await db.transaction().execute(async (trx) => {
    const order = await trx
      .selectFrom("orders")
      .select(["current_status", "appointment_id", "lead_id"])
      .where("id", "=", parsed.orderId)
      .forUpdate()
      .executeTakeFirst();
    if (!order) throw new Error("Order not found");
    if (order.current_status !== parsed.expectedStatus) {
      throw new Error("Order status already changed. Refresh and try again.");
    }
    if (order.current_status === "quotation_sent") {
      const quotation = await trx.selectFrom("order_quotations").select(["invoice_sync_state", "zoho_invoice_id"]).where("order_id", "=", parsed.orderId).where("superseded_at", "is", null).forUpdate().executeTakeFirst();
      if (quotation && (["pending", "uncertain"].includes(quotation.invoice_sync_state) || quotation.zoho_invoice_id)) {
        throw new Error("This order has a pending or created Zoho invoice and cannot be reverted from Quotation Sent");
      }
    }
    if (order.current_status === "deposit_received") {
      const quotation = await trx.selectFrom("order_quotations").select(["payment_sync_state", "zoho_payment_id"]).where("order_id", "=", parsed.orderId).where("superseded_at", "is", null).forUpdate().executeTakeFirst();
      if (quotation && (["pending", "uncertain"].includes(quotation.payment_sync_state) || quotation.zoho_payment_id)) {
        throw new Error("This order has a pending or recorded Zoho deposit payment and cannot be reverted from Deposit Received");
      }
    }

    const idx = STATUS_FLOW.indexOf(order.current_status);
    if (idx <= 0) throw new Error("Cannot revert further");
    const prev = STATUS_FLOW[idx - 1];

    // Installation can be booked in advance from PO Ready onward.
    // Do not cross back into the measurement-review journey while that booking (or a
    // pending Calendar deletion) still exists, because the booking card would
    // no longer be visible there.
    if (order.current_status === "po_ready") {
      const arrangement = await trx
        .selectFrom("fulfilment_arrangements")
        .select(["id", "cancelled_at", "google_sync_state"])
        .where("order_id", "=", parsed.orderId)
        .executeTakeFirst();
      if (arrangement && !arrangement.cancelled_at) {
        throw new Error(
          "This order still has an installation booking. Cancel it before reverting farther.",
        );
      }
      if (
        arrangement?.cancelled_at &&
        arrangement.google_sync_state !== "synced"
      ) {
        throw new Error(
          "The cancelled installation is still pending Calendar removal. Retry Calendar sync before reverting farther.",
        );
      }
    }

    const fallbackLeadId = !order.lead_id && order.appointment_id
      ? (
          await trx.selectFrom("appointments").select("lead_id")
            .where("id", "=", order.appointment_id).executeTakeFirst()
        )?.lead_id
      : undefined;
    const leadId = order.lead_id ?? fallbackLeadId;
    const linkedLead = leadId
      ? await trx.selectFrom("leads").select(["id", "funnel_stage"])
          .where("id", "=", leadId).forUpdate().executeTakeFirst()
      : undefined;

    await trx.insertInto("order_status_events").values({
      order_id: parsed.orderId,
      status: prev,
      note: `[REVERTED] ${parsed.reason.trim()}`,
      created_by: session.user.id,
    }).execute();

    const leadState = leadStateForRevertedOrderStatus(prev);
    if (linkedLead && leadState) {
      const changedAt = new Date();
      await trx.updateTable("leads").set({
        funnel_stage: leadState.stage,
        last_outcome: leadState.outcome,
        ...(prev === "order_recorded" ? { quotation_sent_at: null } : {}),
        updated_at: changedAt,
      }).where("id", "=", linkedLead.id).execute();
      if (linkedLead.funnel_stage !== leadState.stage) {
        await trx.insertInto("lead_stage_events").values({
          lead_id: linkedLead.id,
          from_stage: linkedLead.funnel_stage,
          to_stage: leadState.stage,
          changed_at: changedAt,
          changed_by: session.user.id,
          source: "system",
        }).execute();
      }
    }
    return linkedLead?.id ?? null;
  });

  revalidatePath(`/orders/${parsed.orderId}`);
  revalidatePath("/orders");
  if (linkedLeadId) {
    revalidatePath("/leads");
    revalidatePath(`/leads/${linkedLeadId}`);
  }
}
