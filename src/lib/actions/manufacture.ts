"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireRole } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";
import { userMessage } from "@/lib/errors";
import { applyAllowance, resolveAllowance } from "@/lib/manufacture/allowance";
import { scaleDoubleDrawSplit } from "@/lib/manufacture/double-draw-split";
import {
  loadAllowanceBook,
  loadManufactureLines,
} from "@/lib/manufacture/load";
import { checkConfirmPreconditions } from "@/lib/manufacture/preconditions";
import { materializeShipmentManifest } from "@/lib/logistics/load";
import { STATUS_LABELS } from "@/lib/status-flow";
import {
  allowanceSchema,
  amendManufactureSchema,
  confirmManufactureSchema,
} from "@/lib/validation/manufacture";

import { generateOrderPos } from "./procurement";

/**
 * Reissue vendor documents after an amendment without undoing the amendment.
 *
 * Called OUTSIDE the transaction on purpose. By the time this runs the
 * measurements are frozen; a missing label, font, or storage failure must not
 * roll that back. The frozen screen explains the problem and allows retrying.
 */
async function generatePosQuietly(
  orderId: string,
): Promise<string | null> {
  try {
    await generateOrderPos(orderId);
    return null;
  } catch (e) {
    console.error("[po] generation failed after amend", e);
    // Returned, not thrown. The caller reports it to the person standing there
    // rather than only to a server log: a document that silently failed to
    // appear reads as "the app made me press an extra button", and the reason
    // — usually a label nobody has filled in — never reaches anyone who could
    // act on it.
    return e instanceof Error ? e.message : "The purchase orders were not generated.";
  }
}

// A message we wrote for a human, as opposed to something Postgres said. It
// survives the catch below unchanged; everything else is replaced by a
// fallback, since a constraint name in a toast helps nobody.
class AuthoredError extends Error {}

/**
 * Parse, turning a ZodError into something a human can act on.
 *
 * A bare `schema.parse()` throws a ZodError, which Next.js masks in production
 * to a generic server-error string — so "Allowance must be a whole number of
 * centimetres" never reaches the toast. Doing this here means the action is
 * self-sufficient: a caller that forgets to pre-validate still gets a readable
 * message, rather than the guarantee resting on one screen remembering to.
 */
function parseOrThrow<T>(
  schema: z.ZodType<T>,
  input: unknown,
  fallback: string,
): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const messages = result.error.issues.map((i) => i.message).filter(Boolean);
  throw new AuthoredError(messages.length ? messages.join(" ") : fallback);
}

export async function saveManufactureAllowance(input: unknown): Promise<void> {
  const session = await requireRole(["admin"]);
  const parsed = parseOrThrow(
    allowanceSchema,
    input,
    "That allowance is not valid.",
  );

  try {
    // updated_at is stamped by the manufacture_allowances_set_updated_at
    // trigger, so it is deliberately absent here.
    const result = await db
      .updateTable("manufacture_allowances")
      .set({
        width_delta_cm: parsed.widthDeltaCm,
        height_delta_cm: parsed.heightDeltaCm,
        updated_by: session.user.id,
      })
      .where("product_line", "=", parsed.productLine)
      .execute();

    // The three rows are seeded by the migration and there is no insert or
    // delete policy, so a zero-row update is unreachable today. It only stays
    // unreachable while the Zod enum, the CHECK constraint and the seed agree;
    // if they ever drift, the failure mode without this is a silent no-op
    // behind a success toast, which is the worst kind to track down.
    // Number(), not a bigint literal: this project's tsconfig target predates
    // ES2020 and 0n does not compile.
    if (Number(result[0]?.numUpdatedRows ?? 0) === 0) {
      throw new Error(
        `No allowance row exists for "${parsed.productLine}". The catalogue and the database disagree — tell an admin.`,
      );
    }
  } catch (e) {
    throw new Error(userMessage(e, "Could not save the allowance."));
  }

  revalidatePath("/admin/product/allowances");
}

/**
 * Freeze an order's manufacturing measurements for PO review.
 *
 * Everything happens in ONE transaction — the status re-read, the line-item
 * load, the precondition check, the measurement rows and the status advance —
 * so a failure part-way leaves no half-confirmed order. This deliberately does
 * not generate files or claim they were sent; that is a later human workflow.
 */
export async function confirmManufactureMeasurements(
  input: unknown,
): Promise<{ poWarning: string | null }> {
  const session = await requireRole(["ops", "admin"]);
  const parsed = parseOrThrow(
    confirmManufactureSchema,
    input,
    "Those manufacturing measurements are not valid.",
  );

  try {
    await db.transaction().execute(async (trx) => {
      const order = await trx
        .selectFrom("orders")
        .select("current_status")
        .where("id", "=", parsed.orderId)
        .executeTakeFirst();
      if (!order) throw new AuthoredError("Order not found");

      // Read through the transaction, so the lines that are checked are exactly
      // the lines that get written — not a snapshot from a second ago.
      const lines = await loadManufactureLines(parsed.orderId, trx);
      const book = await loadAllowanceBook(trx);

      const overrides = new Map(parsed.lines.map((l) => [l.lineId, l]));

      // The payload and the order must describe exactly the same set of pieces.
      //
      // An EXTRA id means the page was built against a version of the order
      // that has since lost a line, and that person's override would be
      // silently dropped. A MISSING id is worse: rows are built by iterating
      // `lines`, so a window added after the page loaded would be manufactured
      // at its computed default and sent to the vendor without anyone having
      // looked at it. Comparing sizes as well as membership also rejects a
      // payload carrying the same lineId twice, which `overrides` would
      // otherwise resolve last-wins.
      const known = new Set(lines.map((l) => l.lineId));
      const sameSet =
        parsed.lines.length === known.size &&
        overrides.size === known.size &&
        parsed.lines.every((l) => known.has(l.lineId));
      if (!sameSet) {
        throw new AuthoredError(
          "This order has changed since the page was loaded. Reload and check the measurements again.",
        );
      }

      const check = checkConfirmPreconditions(
        lines,
        book,
        order.current_status,
        overrides,
      );
      if (!check.ok) throw new AuthoredError(check.reasons.join(" "));

      const rows = lines.map((line) => {
        const allowance = resolveAllowance(book, line.line);
        const applied = allowance
          ? applyAllowance(
              { widthCm: line.widthCm, heightCm: line.heightCm },
              allowance,
            )
          : null;
        // Unreachable: the precondition check above rejects both cases. It
        // stays because the alternative is a non-null assertion that would go
        // quietly wrong if the two ever drifted apart.
        if (!applied) {
          throw new AuthoredError(
            "Could not derive the manufacturing measurements for this order.",
          );
        }

        const override = overrides.get(line.lineId);
        const mfgWidthCm = override?.overrideWidthCm ?? applied.mfgWidthCm;
        const mfgHeightCm = override?.overrideHeightCm ?? applied.mfgHeightCm;
        const defaultSplit = scaleDoubleDrawSplit(
          mfgWidthCm,
          line.splitLeftCm,
          line.splitRightCm,
        );
        const isSplitOverridden = defaultSplit != null && (
          override?.mfgSplitLeftCm !== defaultSplit.leftCm ||
          override?.mfgSplitRightCm !== defaultSplit.rightCm
        );
        const isOverridden =
          override?.overrideWidthCm != null ||
          override?.overrideHeightCm != null ||
          isSplitOverridden;

        return {
          order_id: parsed.orderId,
          window_id: line.kind === "window" ? line.lineId : null,
          mesh_panel_id: line.kind === "mesh_panel" ? line.lineId : null,
          source_width_cm: applied.sourceWidthCm,
          source_height_cm: applied.sourceHeightCm,
          // Derived from the stored result, not copied from the allowance, so
          // source + delta = mfg holds on an overridden row too. A reader must
          // never have to wonder why the three numbers disagree.
          width_delta_cm: mfgWidthCm - applied.sourceWidthCm,
          height_delta_cm: mfgHeightCm - applied.sourceHeightCm,
          mfg_width_cm: mfgWidthCm,
          mfg_height_cm: mfgHeightCm,
          mfg_split_left_cm: override?.mfgSplitLeftCm ?? null,
          mfg_split_right_cm: override?.mfgSplitRightCm ?? null,
          is_overridden: isOverridden,
          override_reason: isOverridden
            ? (override?.overrideReason?.trim() || null)
            : null,
          confirmed_by: session.user.id,
        };
      });

      await trx.insertInto("manufacture_measurements").values(rows).execute();

      // The ordinary status-events path: the validate_status_transition trigger
      // and the RLS advance policy apply unchanged, orders.current_status is
      // updated by that trigger rather than written here, and the move is
      // recorded with an actor and a timestamp like any other.
      await trx
        .insertInto("order_status_events")
        .values({
          order_id: parsed.orderId,
          status: "po_ready",
          note: null,
          created_by: session.user.id,
        })
        .execute();
    });
  } catch (e) {
    if (e instanceof AuthoredError) throw new Error(e.message);
    throw new Error(
      userMessage(e, "Could not confirm the manufacturing measurements."),
    );
  }

  revalidatePath(`/orders/${parsed.orderId}`);
  revalidatePath(`/orders/${parsed.orderId}/manufacture`);
  revalidatePath("/orders");

  return { poWarning: null };
}

/** Record the human handoff only after the generated documents were reviewed. */
export async function markOrderSentToVendor(orderId: unknown): Promise<void> {
  const session = await requireRole(["ops", "admin"]);
  const parsedId = parseOrThrow(
    z.string().uuid(),
    orderId,
    "That is not a valid order.",
  );

  try {
    await db.transaction().execute(async (trx) => {
      const order = await trx.selectFrom("orders")
        .select(["current_status", "product_line"])
        .where("id", "=", parsedId)
        .forUpdate()
        .executeTakeFirst();
      if (!order) throw new AuthoredError("Order not found");
      if (order.current_status !== "po_ready") {
        throw new AuthoredError(
          `This order is at "${STATUS_LABELS[order.current_status]}". Only a PO Ready order can be marked as sent.`,
        );
      }

      const current = await trx.selectFrom("manufacture_pos")
        .select(["id", "category"])
        .where("order_id", "=", parsedId)
        .where("superseded_at", "is", null)
        .execute();
      if (order.product_line !== "mesh" &&
        (current.length === 0 || current.some((po) => po.category == null))) {
        throw new AuthoredError(
          "Generate and review the Day, Night, or Blinds purchase orders before marking this order as sent.",
        );
      }

      const shipmentCategories = await materializeShipmentManifest(trx, parsedId);
      if (shipmentCategories.length === 0) {
        throw new AuthoredError(
          "No shipment orders were found. Review the order items before marking it as sent.",
        );
      }

      await trx.insertInto("order_status_events").values({
        order_id: parsedId,
        status: "sent_to_vendor",
        note: "Purchase orders manually sent to vendor",
        created_by: session.user.id,
      }).execute();
    });
  } catch (error) {
    if (error instanceof AuthoredError) throw new Error(error.message);
    throw new Error(userMessage(error, "Could not mark the order as sent to vendor."));
  }

  revalidatePath(`/orders/${parsedId}`);
  revalidatePath(`/orders/${parsedId}/manufacture`);
  revalidatePath("/orders");
}

/**
 * Correct frozen manufacturing measurements before or just after vendor handoff.
 *
 * The order stays at its current PO Ready or Sent to Vendor status.
 *
 * Rows are UPDATED, never re-inserted — there is exactly one measurement row
 * per line item (two partial unique indexes enforce it), and the history of
 * what changed lives in the status timeline, which the whole team already
 * reads, rather than in a pile of superseded rows nobody looks at.
 */
export async function amendManufactureMeasurements(
  input: unknown,
): Promise<void> {
  const session = await requireRole(["admin"]);
  const parsed = parseOrThrow(
    amendManufactureSchema,
    input,
    "That amendment is not valid.",
  );

  try {
    await db.transaction().execute(async (trx) => {
      const order = await trx
        .selectFrom("orders")
        .select("current_status")
        .where("id", "=", parsed.orderId)
        .executeTakeFirst();
      if (!order) throw new AuthoredError("Order not found");

      // PO Ready is frozen but unsent; Sent to Vendor may need a documented
      // correction. Later means the goods have shipped and is too late.
      if (order.current_status !== "po_ready" && order.current_status !== "sent_to_vendor") {
        throw new AuthoredError(
          `This order is at "${STATUS_LABELS[order.current_status]}". Manufacturing measurements can only be amended while it is PO Ready or Sent to Vendor.`,
        );
      }

      // Last-wins on a repeated id would silently drop one of the two edits.
      const ids = new Set(parsed.lines.map((l) => l.lineId));
      if (ids.size !== parsed.lines.length) {
        throw new AuthoredError(
          "The same line item was submitted twice. Reload and try again.",
        );
      }

      const existing = await trx
        .selectFrom("manufacture_measurements")
        .select([
          "id",
          "window_id",
          "mesh_panel_id",
          "source_width_cm",
          "source_height_cm",
          "mfg_split_left_cm",
          "mfg_split_right_cm",
        ])
        .where("order_id", "=", parsed.orderId)
        .execute();

      const byLine = new Map(
        existing.map((r) => [(r.window_id ?? r.mesh_panel_id) as string, r]),
      );

      for (const line of parsed.lines) {
        const row = byLine.get(line.lineId);
        // No insert fallback on purpose: a line with no frozen row was never
        // sent to the vendor, and inventing one here would put a measurement
        // into the record that no reconciliation screen ever showed a human.
        if (!row) {
          throw new AuthoredError(
            "That line item has no confirmed measurement on this order. Reload and try again.",
          );
        }

        // Deltas are recomputed from the STORED source, never re-snapshotted
        // from the window: source records what the set was originally derived
        // from, and the order is locked so it cannot have moved.
        const hasStoredSplit =
          row.mfg_split_left_cm != null && row.mfg_split_right_cm != null;
        const hasSubmittedSplit =
          line.mfgSplitLeftCm != null && line.mfgSplitRightCm != null;
        if (!hasStoredSplit && hasSubmittedSplit) {
          throw new AuthoredError(
            "A left/right split can only be amended on a window that already has a confirmed split.",
          );
        }
        const resizedSplit = hasSubmittedSplit
          ? {
              leftCm: line.mfgSplitLeftCm!,
              rightCm: line.mfgSplitRightCm!,
            }
          : scaleDoubleDrawSplit(
              line.mfgWidthCm,
              row.mfg_split_left_cm,
              row.mfg_split_right_cm,
            );
        await trx
          .updateTable("manufacture_measurements")
          .set({
            mfg_width_cm: line.mfgWidthCm,
            mfg_height_cm: line.mfgHeightCm,
            mfg_split_left_cm: resizedSplit?.leftCm ?? null,
            mfg_split_right_cm: resizedSplit?.rightCm ?? null,
            width_delta_cm: line.mfgWidthCm - row.source_width_cm,
            height_delta_cm: line.mfgHeightCm - row.source_height_cm,
            is_overridden: true,
            override_reason: parsed.reason,
          })
          .where("id", "=", row.id)
          .execute();
      }

      // Same status, so validate_status_transition's "new = current" branch
      // and the ose_insert_advance_or_note RLS policy both allow it. The
      // amendment lands in the timeline the whole team already reads instead
      // of in a log only a developer would find.
      await trx
        .insertInto("order_status_events")
        .values({
          order_id: parsed.orderId,
          status: order.current_status,
          note: `[MEASUREMENTS AMENDED] ${parsed.reason}`,
          created_by: session.user.id,
        })
        .execute();
    });
  } catch (e) {
    if (e instanceof AuthoredError) throw new Error(e.message);
    throw new Error(
      userMessage(e, "Could not amend the manufacturing measurements."),
    );
  }

  // An amendment supersedes and reissues: the vendor's copy now states a
  // dimension we no longer intend, and the corrected document is the whole
  // point of having amended.
  await generatePosQuietly(parsed.orderId);

  revalidatePath(`/orders/${parsed.orderId}`);
  revalidatePath(`/orders/${parsed.orderId}/manufacture`);
}
