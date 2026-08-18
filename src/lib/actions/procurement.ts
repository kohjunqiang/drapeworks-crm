"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireRole } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";
import { userMessage } from "@/lib/errors";
import {
  poOpeningLabelSchema,
  poTypeLabelSchema,
  procurementSettingsSchema,
  roomTypeLabelSchema,
  seriesNameCnSchema,
} from "@/lib/validation/procurement";

// Same two pieces as manufacture.ts, for the same reason: a ZodError is masked
// by Next.js in production, so "Room code is required." would otherwise reach
// the toast as a generic server error and the admin would be left guessing
// which of forty fields on this screen it meant.
class AuthoredError extends Error {}

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

const PROCUREMENT_PATH = "/admin/procurement";

/**
 * The singleton company + delivery row.
 *
 * updated_at is stamped by the procurement_settings_set_updated_at trigger, so
 * it is deliberately absent here — as everywhere else in this codebase.
 */
export async function saveProcurementSettings(input: unknown): Promise<void> {
  await requireRole(["admin"]);
  const parsed = parseOrThrow(
    procurementSettingsSchema,
    input,
    "Those procurement settings are not valid.",
  );

  try {
    const result = await db
      .updateTable("procurement_settings")
      .set({
        company_name: parsed.companyName,
        company_uen: parsed.companyUen,
        address_line1: parsed.addressLine1,
        address_line2: parsed.addressLine2,
        phone: parsed.phone,
        wechat: parsed.wechat,
        website: parsed.website,
        air_shipping_mark: parsed.airShippingMark,
        warehouse_address_cn: parsed.warehouseAddressCn,
        recipient_cn: parsed.recipientCn,
        delivery_phone: parsed.deliveryPhone,
        curtain_style_cn: parsed.curtainStyleCn,
        heat_setting_cn: parsed.heatSettingCn,
        floor_clearance_cm: parsed.floorClearanceCm,
      })
      .where("singleton", "=", true)
      .execute();

    // The row is seeded by 202608181700_seed_procurement.ts. A zero-row update
    // means it is missing, and silently succeeding would leave every PO
    // refusing to generate with nothing on this screen to explain why.
    // Number(), not a bigint literal: the tsconfig target predates ES2020.
    if (Number(result[0]?.numUpdatedRows ?? 0) === 0) {
      throw new AuthoredError(
        "No procurement settings row exists. Re-run `npm run db:migrate`.",
      );
    }
  } catch (e) {
    if (e instanceof AuthoredError) throw new Error(e.message);
    throw new Error(userMessage(e, "Could not save the procurement settings."));
  }

  revalidatePath(PROCUREMENT_PATH);
}

/**
 * One room type's 房间 label.
 *
 * An UPSERT, because six of the ten room types have no row at all — Kitchen,
 * Balcony and the rest were never evidenced by the samples, so the seed left
 * them out rather than invent them. Filling one in on this screen is what
 * creates it.
 */
export async function saveRoomTypeLabel(input: unknown): Promise<void> {
  await requireRole(["admin"]);
  const parsed = parseOrThrow(
    roomTypeLabelSchema,
    input,
    "That room label is not valid.",
  );

  try {
    await db
      .insertInto("room_type_labels")
      .values({
        room_type: parsed.roomType,
        name_cn: parsed.nameCn,
        code: parsed.code,
      })
      .onConflict((oc) =>
        oc.column("room_type").doUpdateSet({
          name_cn: parsed.nameCn,
          code: parsed.code,
        }),
      )
      .execute();
  } catch (e) {
    throw new Error(
      userMessage(e, `Could not save the label for "${parsed.roomType}".`),
    );
  }

  revalidatePath(PROCUREMENT_PATH);
}

/**
 * One 窗帘款式 label.
 *
 * UPDATE, not upsert: the five keys are fixed by a CHECK constraint and all
 * five rows are seeded. A zero-row update therefore means the key does not
 * exist, which is worth saying rather than quietly inserting a sixth.
 */
export async function savePoTypeLabel(input: unknown): Promise<void> {
  await requireRole(["admin"]);
  const parsed = parseOrThrow(
    poTypeLabelSchema,
    input,
    "That type label is not valid.",
  );

  try {
    const result = await db
      .updateTable("po_type_labels")
      .set({ label_cn: parsed.labelCn })
      .where("key", "=", parsed.key)
      .execute();

    if (Number(result[0]?.numUpdatedRows ?? 0) === 0) {
      throw new AuthoredError(
        `No type label row exists for "${parsed.key}". Re-run \`npm run db:migrate\`.`,
      );
    }
  } catch (e) {
    if (e instanceof AuthoredError) throw new Error(e.message);
    throw new Error(userMessage(e, "Could not save the type label."));
  }

  revalidatePath(PROCUREMENT_PATH);
}

/** One 开法 label. UPDATE only, for the same reason as the type labels. */
export async function savePoOpeningLabel(input: unknown): Promise<void> {
  await requireRole(["admin"]);
  const parsed = parseOrThrow(
    poOpeningLabelSchema,
    input,
    "That opening label is not valid.",
  );

  try {
    const result = await db
      .updateTable("po_opening_labels")
      .set({ label_cn: parsed.labelCn })
      .where("draw", "=", parsed.draw)
      .execute();

    if (Number(result[0]?.numUpdatedRows ?? 0) === 0) {
      throw new AuthoredError(
        `No opening label row exists for "${parsed.draw}".`,
      );
    }
  } catch (e) {
    if (e instanceof AuthoredError) throw new Error(e.message);
    throw new Error(userMessage(e, "Could not save the opening label."));
  }

  revalidatePath(PROCUREMENT_PATH);
}

/** A blind series' Chinese wording — 卷帘 for a roller, and so on. */
export async function saveSeriesNameCn(input: unknown): Promise<void> {
  await requireRole(["admin"]);
  const parsed = parseOrThrow(
    seriesNameCnSchema,
    input,
    "That series name is not valid.",
  );

  try {
    const result = await db
      .updateTable("curtain_series")
      .set({ name_cn: parsed.nameCn })
      .where("id", "=", parsed.seriesId)
      .execute();

    if (Number(result[0]?.numUpdatedRows ?? 0) === 0) {
      throw new AuthoredError(
        "That series no longer exists. Reload and try again.",
      );
    }
  } catch (e) {
    if (e instanceof AuthoredError) throw new Error(e.message);
    throw new Error(userMessage(e, "Could not save the series name."));
  }

  // The catalogue screens show the series too, so a rename there and a Chinese
  // name here must not disagree after a save.
  revalidatePath(PROCUREMENT_PATH);
  revalidatePath("/admin/product/blinds");
}
