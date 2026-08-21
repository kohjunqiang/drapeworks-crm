"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { randomInt, randomUUID } from "node:crypto";

import { requireRole } from "@/lib/auth/require-role";
import { db } from "@/lib/db/kysely";
import { userMessage } from "@/lib/errors";
import { generateOrderReference } from "@/lib/orders/reference";
import { buildPos } from "@/lib/po/build";
import { loadPoInput } from "@/lib/po/load";
import { renderPo } from "@/lib/po/render";
import { adminClient } from "@/lib/supabase/admin";
import {
  deliveryVendorSchema,
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
        track_note_cn: parsed.trackNoteCn,
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

// ── 收货地址 ───────────────────────────────────────────────────────────────

/**
 * Create or update one delivery address.
 *
 * Making a row the default UNSETS the previous one in the same transaction. A
 * unique partial index refuses two defaults outright, so doing it in two
 * statements outside a transaction would fail against the database rather than
 * quietly leave the wrong one in force — but a failed save that had already
 * cleared the old default would leave the business with NO delivery address,
 * and every PO after it printing no block. Hence one transaction.
 */
export async function saveDeliveryVendor(input: unknown): Promise<void> {
  await requireRole(["admin"]);
  const parsed = parseOrThrow(
    deliveryVendorSchema,
    input,
    "That delivery address is not valid.",
  );

  const values = {
    label: parsed.label,
    shipping_mark_cn: parsed.shippingMarkCn,
    address_cn: parsed.addressCn,
    recipient_cn: parsed.recipientCn,
    phone: parsed.phone,
  };

  try {
    await db.transaction().execute(async (trx) => {
      if (parsed.isDefault) {
        await trx
          .updateTable("delivery_vendors")
          .set({ is_default: false })
          .where("is_default", "=", true)
          .execute();
      }

      if (parsed.id) {
        const result = await trx
          .updateTable("delivery_vendors")
          .set({ ...values, ...(parsed.isDefault ? { is_default: true } : {}) })
          .where("id", "=", parsed.id)
          .execute();
        if (Number(result[0]?.numUpdatedRows ?? 0) === 0) {
          throw new AuthoredError(
            "That delivery address no longer exists. Reload and try again.",
          );
        }
        return;
      }

      await trx
        .insertInto("delivery_vendors")
        // The first address anybody adds is the default, whether or not they
        // ticked the box: an address nothing uses is not an answer to "where
        // does this ship to".
        .values({ ...values, is_default: parsed.isDefault ?? false })
        .execute();
    });
  } catch (e) {
    if (e instanceof AuthoredError) throw new Error(e.message);
    throw new Error(userMessage(e, "Could not save the delivery address."));
  }

  revalidatePath(PROCUREMENT_PATH);
}

/**
 * Archive or restore one.
 *
 * The default cannot be archived. Archiving it would leave the documents with
 * no delivery block and nothing on this screen saying why — so the refusal
 * names the fix instead: make another one the default first.
 */
export async function toggleDeliveryVendorActive(id: unknown): Promise<void> {
  await requireRole(["admin"]);
  const parsedId = parseOrThrow(
    z.string().uuid(),
    id,
    "That is not a valid delivery address.",
  );

  const current = await db
    .selectFrom("delivery_vendors")
    .select(["is_active", "is_default"])
    .where("id", "=", parsedId)
    .executeTakeFirst();
  if (!current) throw new Error("That delivery address no longer exists.");

  if (current.is_active && current.is_default) {
    throw new Error(
      "That is the address every purchase order ships to. Make another one the default before archiving it.",
    );
  }

  try {
    await db
      .updateTable("delivery_vendors")
      .set({ is_active: !current.is_active })
      .where("id", "=", parsedId)
      .execute();
  } catch (e) {
    throw new Error(userMessage(e, "Could not update the delivery address."));
  }

  revalidatePath(PROCUREMENT_PATH);
}

// ── Generating the documents ───────────────────────────────────────────────

const PO_BUCKET = "manufacture-pos";

/** 5 minutes: long enough to click, short enough that a leaked link is dead. */
const SIGNED_URL_SECONDS = 300;

const orderIdSchema = z.string().uuid("That is not a valid order.");
const poIdSchema = z.string().uuid("That is not a valid document.");

/**
 * "PO-10040-Rising.pdf".
 *
 * ASCII only, and not because the rest of the system is squeamish about Hanzi —
 * this string travels in a Content-Disposition header and then becomes a file on
 * whatever phone or laptop it lands on. The CONTENT is the Chinese document; the
 * filename only has to survive the trip.
 */
function poFileName(poNumber: string, vendorName: string | null): string {
  const slug = (s: string) =>
    s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const parts = ["PO", slug(poNumber), vendorName ? slug(vendorName) : ""].filter(
    Boolean,
  );
  return `${parts.join("-") || "PO"}.pdf`;
}

/**
 * Generate one 采购订单 per vendor for an order, from its frozen measurements.
 *
 * REFUSES rather than producing a partial document. Every missing Chinese label,
 * every unset vendor, every window without a frozen dimension comes back as a
 * named problem and nothing is written — a blank cell on a cutting instruction
 * does not read as "not applicable" in Shenzhen, it reads as an omission, and
 * somebody fills it in by guessing. That refusal is the feature; see
 * lib/po/build.ts.
 *
 * Regenerating SUPERSEDES the previous documents instead of deleting them. A
 * vendor may already be cutting fabric from one, and "what did we actually send,
 * and when" is the only way to settle an argument about a wrong dimension.
 */
/**
 * Make sure the order has a reference, minting one if it does not.
 *
 * The reference IS the PO number, so generation used to refuse without one —
 * which asked a human to invent an identifier the system is perfectly capable
 * of inventing itself. It stays editable afterwards: a minted reference is a
 * default, not a decision, and the business overwrites it whenever it has its
 * own numbering.
 *
 * Writing it is allowed even though the order is locked by then: order_reference
 * is on the lock trigger's allow-list precisely because it is paperwork rather
 * than a manufacturing input.
 */
async function ensureOrderReference(orderId: string): Promise<string> {
  const existing = await db
    .selectFrom("orders")
    .select("order_reference")
    .where("id", "=", orderId)
    .executeTakeFirst();
  if (!existing) throw new AuthoredError("That order no longer exists.");

  const current = existing.order_reference?.trim() ?? "";
  if (current) return current;

  // The partial unique index is the authority, not the odds. 32^8 makes a
  // collision vanishingly unlikely, but retrying costs nothing and turns
  // "vanishingly unlikely" into "handled".
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateOrderReference((max) => randomInt(max));
    try {
      await db
        .updateTable("orders")
        .set({ order_reference: candidate })
        .where("id", "=", orderId)
        .execute();
      return candidate;
    } catch (e) {
      // 23505 = unique_violation on orders_order_reference_key. Anything else
      // is not a collision and must not be retried.
      const code =
        typeof e === "object" && e !== null && "code" in e ? e.code : null;
      if (code !== "23505") throw e;
    }
  }
  throw new AuthoredError(
    "Could not allocate an order reference. Set one by hand on the order.",
  );
}

export async function generateOrderPos(
  orderId: string,
): Promise<{ count: number }> {
  const session = await requireRole(["ops", "admin"]);
  const parsedId = parseOrThrow(
    orderIdSchema,
    orderId,
    "That is not a valid order.",
  );

  // Passed in rather than read inside the builder, so the row we store, the
  // date on the page and the moment the previous documents stop being current
  // are all the same instant.
  const generatedAt = new Date();

  // Before loading: the loader refuses without a reference, and there is no
  // reason to make a person type one we can mint.
  await ensureOrderReference(parsedId);

  const loaded = await loadPoInput(parsedId, generatedAt);
  if (!loaded.input) throw new Error(refusal(loaded.problems));

  const { pos, problems } = buildPos(loaded.input);
  if (problems.length > 0) throw new Error(refusal(problems));
  if (pos.length === 0) {
    throw new Error(
      "There is nothing to put on a purchase order for this order.",
    );
  }

  // Render everything BEFORE anything is stored. A font that will not load or a
  // document that will not paginate should fail with no rows written and no
  // objects orphaned, rather than half-way through a set of three.
  //
  // The id is minted here rather than left to the column default because the
  // storage path contains it, and the row and the object have to agree.
  const documents = await Promise.all(
    pos.map(async (doc) => {
      const id = randomUUID();
      return {
        id,
        vendorId: doc.vendor.id,
        // Snapshot: order_reference stays editable after the order locks, and a
        // document already in Shenzhen cannot be retroactively renamed by
        // somebody tidying up a reference in the CRM. The row has to keep
        // saying what the page says.
        poNumber: doc.poNumber,
        notes: doc.notes,
        path: `pos/${parsedId}/${id}.pdf`,
        bytes: await renderPo(doc),
      };
    }),
  );

  try {
    // The user's own session, not the service-role client: the bucket's RLS
    // The service-role client, deliberately, and NOT the user's session.
    //
    // The role `authenticated` holds no grants on any table in `public`, and
    // is_admin()/is_ops() are not SECURITY DEFINER — so any storage policy
    // evaluated as that role dies on "permission denied for table rooms" (the
    // room-photos INSERT policy on storage.objects is permissive and Postgres
    // evaluates it whatever bucket you are writing to) or, past that, on
    // profiles. This was the first code in the app to actually run as
    // `authenticated`, which is why nothing had hit it before.
    //
    // Authorization is not weakened: requireRole(["ops","admin"]) above is the
    // gate, which is how access control actually works in this codebase today.
    // sweepPhotoStorage already reaches for the same client for the same
    // reason. Making RLS real is a separate piece of work — see the note in
    // 202608181300_lock_blocks_delete.ts.
    //
    // These bytes do go through the Next.js process, which the upload rule
    // forbids for photos — but there is no client to upload from. The document
    // is generated on the server and is a couple of pages of vector PDF.
    const supabase = adminClient();
    for (const document of documents) {
      const { error } = await supabase.storage
        .from(PO_BUCKET)
        .upload(document.path, document.bytes, {
          contentType: "application/pdf",
          upsert: false,
        });
      if (error) {
        throw new Error(userMessage(error, "Could not store the purchase order."));
      }
    }

    await db.transaction().execute(async (trx) => {
      // Supersede, never delete. Same instant as the new documents' generated_at,
      // so the record never shows a gap with no document in force.
      await trx
        .updateTable("manufacture_pos")
        .set({ superseded_at: generatedAt })
        .where("order_id", "=", parsedId)
        .where("superseded_at", "is", null)
        .execute();

      await trx
        .insertInto("manufacture_pos")
        .values(
          documents.map((document) => ({
            id: document.id,
            order_id: parsedId,
            vendor_id: document.vendorId,
            po_number: document.poNumber,
            storage_path: document.path,
            notes: document.notes,
            generated_at: generatedAt,
            generated_by: session.user.id,
          })),
        )
        .execute();
    });
  } catch (e) {
    throw new Error(userMessage(e, "Could not generate the purchase orders."));
  }

  revalidatePath(`/orders/${parsedId}/manufacture`);
  revalidatePath(`/orders/${parsedId}`);
  return { count: documents.length };
}

/** Every reason, in one sentence, so nothing has to be discovered twice. */
function refusal(problems: string[]): string {
  return problems.length > 0
    ? `The purchase orders were not generated. ${problems.join(" ")}`
    : "The purchase orders could not be generated.";
}

/** How the browser should treat the document behind a signed URL. */
const poUrlModeSchema = z.enum(["download", "inline"]);

/**
 * A short-lived signed URL for one generated document.
 *
 * The bucket is private and stays private: this is the only way to reach a
 * document, and it costs a role check every time.
 *
 * `mode` decides the Content-Disposition. "download" saves the file under a
 * name a vendor can read; "inline" lets the browser's own PDF viewer render it,
 * which is what the preview needs — the same bytes, not a second rendering that
 * could disagree with the one the vendor was sent.
 */
export async function getPoDownloadUrl(
  poId: string,
  mode: "download" | "inline" = "download",
): Promise<{ url: string; fileName: string }> {
  await requireRole(["ops", "admin"]);
  const parsedId = parseOrThrow(
    poIdSchema,
    poId,
    "That is not a valid document.",
  );
  const parsedMode = parseOrThrow(
    poUrlModeSchema,
    mode,
    "That is not a way to open a document.",
  );

  const row = await db
    .selectFrom("manufacture_pos")
    .leftJoin("vendors", "vendors.id", "manufacture_pos.vendor_id")
    .select([
      "manufacture_pos.storage_path as storage_path",
      "manufacture_pos.po_number as po_number",
      "vendors.name as vendor_name",
    ])
    .where("manufacture_pos.id", "=", parsedId)
    .executeTakeFirst();
  if (!row) throw new Error("That purchase order no longer exists.");

  const fileName = poFileName(row.po_number, row.vendor_name);

  // Service-role for the same reason as the upload above: the bucket is
  // private, the role guard on this action is the access control, and a
  // session-scoped client cannot evaluate storage policies at all here.
  const supabase = adminClient();
  const { data, error } = await supabase.storage
    .from(PO_BUCKET)
    .createSignedUrl(
      row.storage_path,
      SIGNED_URL_SECONDS,
      parsedMode === "download" ? { download: fileName } : {},
    );
  if (error || !data) {
    throw new Error(userMessage(error, "Could not open that purchase order."));
  }

  return { url: data.signedUrl, fileName };
}
