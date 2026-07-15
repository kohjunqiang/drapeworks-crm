import Link from "next/link";
import { notFound } from "next/navigation";

import { ConsultationForm } from "@/components/orders/consultation-form";
import type { UploaderPhoto } from "@/components/orders/photo-uploader";
import { requireRole } from "@/lib/auth/require-role";
import { loadActiveCurtainTypeOptions } from "@/lib/db/curtain-types";
import { db } from "@/lib/db/kysely";
import { signRoomPhotoUrls } from "@/lib/db/photos";
import {
  isToiletRoom,
  type OrderEditInput,
} from "@/lib/validation/order";

export const dynamic = "force-dynamic";

export const metadata = { title: "Edit order — Drapeworks CRM" };

type Params = { orderId: string };

function toDateInput(d: Date | string | null): string {
  if (!d) return "";
  const iso = new Date(d).toISOString();
  return iso.slice(0, 10);
}

export default async function EditOrderPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { orderId } = await params;
  const session = await requireRole(["consultant", "admin"]);

  const order = await db
    .selectFrom("orders")
    .innerJoin("customers", "customers.id", "orders.customer_id")
    .select([
      "orders.id as id",
      "orders.display_id as display_id",
      "orders.consultant_id as consultant_id",
      "orders.property_type as property_type",
      "orders.development as development",
      "orders.unit_type as unit_type",
      "orders.move_in_date as move_in_date",
      "orders.price_quoted_cents as price_quoted_cents",
      "orders.deposit_cents as deposit_cents",
      "orders.general_notes as general_notes",
      "orders.is_draft as is_draft",
      "customers.name as customer_name",
      "customers.mobile as customer_mobile",
      "customers.email as customer_email",
    ])
    .where("orders.id", "=", orderId)
    .executeTakeFirst();
  if (!order) notFound();

  const isOwner = order.consultant_id === session.user.id;
  const isAdmin = session.profile.role === "admin";
  if (!isOwner && !isAdmin) notFound();

  const rooms = await db
    .selectFrom("rooms")
    .select(["id", "type", "label", "position"])
    .where("order_id", "=", order.id)
    .orderBy("position", "asc")
    .execute();

  const roomIds = rooms.map((r) => r.id);

  const windows =
    roomIds.length === 0
      ? []
      : await db
          .selectFrom("windows")
          .select([
            "id",
            "room_id",
            "position",
            "width_cm",
            "height_cm",
            "install_width_cm",
            "notes",
            "curtain_type_id",
            "day_curtain_type_id",
            "night_curtain_type_id",
            "draw",
            "add_s_fold",
            "add_slim_tracks",
          ])
          .where("room_id", "in", roomIds)
          .orderBy("position", "asc")
          .execute();

  const windowsByRoom = new Map<string, typeof windows>();
  for (const w of windows) {
    const list = windowsByRoom.get(w.room_id) ?? [];
    list.push(w);
    windowsByRoom.set(w.room_id, list);
  }

  const photos =
    roomIds.length === 0
      ? []
      : await db
          .selectFrom("room_photos")
          .select([
            "id",
            "room_id",
            "storage_path",
            "original_name",
            "position",
            "created_at",
          ])
          .where("room_id", "in", roomIds)
          .orderBy("position", "asc")
          .orderBy("created_at", "asc")
          .execute();

  const signed = await signRoomPhotoUrls(photos.map((p) => p.storage_path));

  const roomPhotos: Record<string, UploaderPhoto[]> = {};
  for (const p of photos) {
    const url = signed.get(p.storage_path);
    if (!url) continue;
    const list = roomPhotos[p.room_id] ?? [];
    list.push({ id: p.id, signedUrl: url, originalName: p.original_name });
    roomPhotos[p.room_id] = list;
  }

  const curtainTypes = await loadActiveCurtainTypeOptions();

  const defaultValues: OrderEditInput = {
    customer: {
      name: order.customer_name,
      mobile: order.customer_mobile,
      email: order.customer_email ?? "",
    },
    order: {
      property_type: order.property_type ?? undefined,
      development: order.development ?? "",
      unit_type: order.unit_type ?? "",
      move_in_date: toDateInput(order.move_in_date),
      price_quoted_cents: order.price_quoted_cents,
      deposit_cents: order.deposit_cents,
      general_notes: order.general_notes ?? "",
      is_draft: order.is_draft,
    },
    rooms: rooms.map((r, rIdx) => {
      const isToilet = isToiletRoom(r.type);
      const wins = windowsByRoom.get(r.id) ?? [];
      return {
        id: r.id,
        type: r.type,
        label: r.label,
        position: rIdx,
        windows: wins.map((w, wIdx) => {
          if (isToilet) {
            return {
              id: w.id,
              variant: "toilet" as const,
              position: wIdx,
              curtain_type_id: w.curtain_type_id ?? "",
              width_cm: w.width_cm ?? null,
              height_cm: w.height_cm ?? null,
              install_width_cm: w.install_width_cm ?? null,
              notes: w.notes ?? "",
            };
          }
          return {
            id: w.id,
            variant: "regular" as const,
            position: wIdx,
            day_curtain_type_id: w.day_curtain_type_id ?? "",
            night_curtain_type_id: w.night_curtain_type_id ?? "",
            draw: w.draw ?? "Double",
            width_cm: w.width_cm ?? null,
            height_cm: w.height_cm ?? null,
            install_width_cm: w.install_width_cm ?? null,
            notes: w.notes ?? "",
            add_s_fold: w.add_s_fold ?? false,
            add_slim_tracks: w.add_slim_tracks ?? false,
          };
        }),
      };
    }),
  };

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="text-xs text-slate-500 mb-3">
        <Link href="/orders" className="hover:text-slate-700">
          Orders
        </Link>
        <span className="mx-1">/</span>
        <Link
          href={`/orders/${order.id}`}
          className="hover:text-slate-700"
        >
          {order.display_id}
        </Link>
        <span className="mx-1">/</span>
        <span className="text-slate-700">Edit</span>
      </div>

      <div className="flex items-start justify-between gap-3 mb-6">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            Edit consultation
          </h1>
          <p className="text-sm text-slate-500 mt-1 truncate">
            {order.display_id} — {order.customer_name}
          </p>
        </div>
        <Link
          href={`/orders/${order.id}`}
          className="px-3 py-1.5 text-sm border border-slate-300 rounded hover:bg-white whitespace-nowrap"
        >
          Back to order
        </Link>
      </div>

      <ConsultationForm
        mode="edit"
        orderId={order.id}
        curtainTypes={curtainTypes}
        defaultValues={defaultValues}
        roomPhotos={roomPhotos}
      />
    </main>
  );
}
