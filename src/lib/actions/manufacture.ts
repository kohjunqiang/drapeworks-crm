"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireRole } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";
import { userMessage } from "@/lib/errors";
import { applyAllowance, resolveAllowance } from "@/lib/manufacture/allowance";
import {
  loadAllowanceBook,
  loadManufactureLines,
} from "@/lib/manufacture/load";
import { checkConfirmPreconditions } from "@/lib/manufacture/preconditions";
import { STATUS_LABELS } from "@/lib/status-flow";
import {
  allowanceSchema,
  amendManufactureSchema,
  confirmManufactureSchema,
} from "@/lib/validation/manufacture";

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
 * Freeze an order's manufacturing measurements and hand it to the vendor.
 *
 * Everything happens in ONE transaction — the status re-read, the line-item
 * load, the precondition check, the measurement rows and the status advance —
 * so a failure part-way leaves no half-confirmed order: no rows, no status
 * change, nothing for the next person to unpick.
 */
export async function confirmManufactureMeasurements(
  input: unknown,
): Promise<void> {
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
        const isOverridden =
          override?.overrideWidthCm != null ||
          override?.overrideHeightCm != null;
        const mfgWidthCm = override?.overrideWidthCm ?? applied.mfgWidthCm;
        const mfgHeightCm = override?.overrideHeightCm ?? applied.mfgHeightCm;

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
          status: "sent_to_vendor",
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
}

/**
 * Correct the manufacturing measurements of an order already with the vendor.
 *
 * The order STAYS at sent_to_vendor. An amendment corrects what the vendor is
 * building; it is not a step backwards through the flow, and reverting the
 * status would misdescribe where the order actually is.
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

      // Only from sent_to_vendor. Earlier and the measurements are not frozen
      // yet (that is the reconciliation screen's job); later and the goods have
      // shipped, so changing what we "told the vendor" would be fiction.
      if (order.current_status !== "sent_to_vendor") {
        throw new AuthoredError(
          `This order is at "${STATUS_LABELS[order.current_status]}". Manufacturing measurements can only be amended while it is at "${STATUS_LABELS.sent_to_vendor}".`,
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
        await trx
          .updateTable("manufacture_measurements")
          .set({
            mfg_width_cm: line.mfgWidthCm,
            mfg_height_cm: line.mfgHeightCm,
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
          status: "sent_to_vendor",
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

  revalidatePath(`/orders/${parsed.orderId}`);
  revalidatePath(`/orders/${parsed.orderId}/manufacture`);
}
