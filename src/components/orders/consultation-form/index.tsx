"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, useFieldArray, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import type { UploaderPhoto } from "@/components/orders/photo-uploader";
import { formDraftKey, useFormDraft } from "./use-form-draft";
import {
  createOrder,
  createOrderDraft,
  updateOrder,
} from "@/lib/actions/orders";
import type { RoomType } from "@/lib/db/schema";
import {
  isToiletRoom,
  orderCreateSchema,
  orderEditSchema,
  type OrderEditInput,
} from "@/lib/validation/order";

import type { CalcConfig } from "@/lib/pricing/order-quote";
import type { ActivePromotion } from "@/lib/db/promotions";
import type { ActiveCombo } from "@/lib/db/combos";

import { CustomerSection } from "./customer-section";
import { LiveQuote } from "./live-quote";
import { PricingSection } from "./pricing-section";
import { QuickAddRoomBar, type RoomTemplate } from "./quick-add-room-bar";
import { RoomCard } from "./room-card";
import type { CurtainTypeOption } from "./window-fields";

type Mode = "create" | "edit";

type Props = {
  mode: Mode;
  curtainTypes: CurtainTypeOption[];
  calcConfig?: CalcConfig | null;
  promotions?: ActivePromotion[];
  combos?: ActiveCombo[];
  orderId?: string;
  defaultValues?: OrderEditInput;
  roomPhotos?: Record<string, UploaderPhoto[]>;
};

function makeWindow(roomType: RoomType, position: number) {
  if (isToiletRoom(roomType)) {
    return {
      variant: "toilet" as const,
      position,
      curtain_type_id: "",
      width_cm: null,
      height_cm: null,
      install_width_cm: null,
      notes: "",
    };
  }
  return {
    variant: "regular" as const,
    position,
    day_curtain_type_id: "",
    night_curtain_type_id: "",
    draw: "Double" as const,
    width_cm: null,
    height_cm: null,
    install_width_cm: null,
    notes: "",
    add_s_fold: false,
    add_slim_tracks: false,
    combo_id: "",
  };
}

const EMPTY_DEFAULTS: OrderEditInput = {
  customer: { name: "", mobile: "", email: "" },
  order: {
    property_type: "HDB",
    development: "",
    unit_type: "",
    move_in_date: "",
    price_quoted_cents: 0,
    deposit_cents: 0,
    general_notes: "",
    is_draft: false,
    freight_mode: "air",
    channel: "standard",
    extra_install_cents: 0,
    discount_bps: 0,
    promo_label: undefined,
  },
  rooms: [
    {
      type: "Living Room",
      label: "Living Room",
      position: 0,
      windows: [makeWindow("Living Room", 0)],
    },
  ],
};

export function ConsultationForm({
  mode,
  curtainTypes,
  calcConfig,
  promotions = [],
  combos = [],
  orderId,
  defaultValues,
  roomPhotos,
}: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const schema = mode === "create" ? orderCreateSchema : orderEditSchema;
  const initial = defaultValues ?? EMPTY_DEFAULTS;

  const form = useForm<OrderEditInput>({
    // The Zod schema's transforms produce a slightly different output shape;
    // the resolver is fine at runtime but the static types diverge. We accept
    // a single any cast here rather than threading the transform types.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema) as any,
    defaultValues: initial,
  });

  const {
    register,
    control,
    handleSubmit,
    getValues,
    formState: { errors },
  } = form;

  // Survive an accidental refresh mid-consultation. Keyed per order so a create
  // and each edited order keep separate drafts.
  const { clearDraft } = useFormDraft(
    form,
    formDraftKey("curtain", mode, orderId),
  );

  const {
    fields: rooms,
    append: appendRoom,
    remove: removeRoom,
  } = useFieldArray({ control, name: "rooms" });

  function handleQuickAdd(template: RoomTemplate) {
    const current = getValues("rooms") ?? [];
    const sameType = current.filter((r) => r.type === template.type).length;
    const label =
      sameType > 0 && template.type === "Bedroom"
        ? `Bedroom ${sameType + 1}`
        : template.label;

    appendRoom({
      type: template.type,
      label,
      position: current.length,
      windows: [makeWindow(template.type, 0)],
    });
  }

  const onSubmit = handleSubmit((values) => {
    const normalised: OrderEditInput = {
      ...values,
      rooms: values.rooms.map((room, rIdx) => ({
        ...room,
        position: rIdx,
        windows: room.windows.map((w, wIdx) => ({ ...w, position: wIdx })),
      })),
    };

    startTransition(async () => {
      try {
        if (mode === "edit") {
          if (!orderId) throw new Error("Missing order id for edit");
          await updateOrder(orderId, normalised);
        } else {
          await createOrder(normalised);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        // The redirect throw is the only success signal, so the recovery
        // draft is dropped here rather than before the call.
        if (msg === "NEXT_REDIRECT" || msg.includes("NEXT_REDIRECT")) {
          clearDraft();
          return;
        }
        toast.error(msg || "Save failed");
      }
    });
  });

  function saveAsDraft() {
    // Use the raw current values (skip the strict Zod resolver so partial
    // input is allowed). The draft action does its own relaxed validation.
    const values = getValues();
    const payload = {
      ...values,
      rooms: (values.rooms ?? []).map((room, rIdx) => ({
        ...room,
        position: rIdx,
        windows: (room.windows ?? []).map((w, wIdx) => ({
          ...w,
          position: wIdx,
        })),
      })),
    };
    startTransition(async () => {
      try {
        await createOrderDraft(payload);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        if (msg === "NEXT_REDIRECT" || msg.includes("NEXT_REDIRECT")) {
          clearDraft();
          return;
        }
        toast.error(msg || "Draft save failed");
      }
    });
  }

  function handleCancel() {
    if (mode === "edit" && orderId) {
      router.push(`/orders/${orderId}`);
    } else {
      router.back();
    }
  }

  return (
    <FormProvider {...form}>
      <form onSubmit={onSubmit}>
        <CustomerSection />
        <PricingSection promotions={promotions} />

        {calcConfig && (
          <LiveQuote
            curtainTypes={curtainTypes}
            config={calcConfig}
            combos={combos}
          />
        )}

        <section className="bg-white rounded-lg border border-slate-200 p-4 sm:p-6 mb-4">
          <div className="flex items-center justify-between mb-4 gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Rooms &amp; measurements
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                All measurements in centimetres (cm)
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">
                {rooms.length} {rooms.length === 1 ? "room" : "rooms"}
              </span>
            </div>
          </div>

          <QuickAddRoomBar onAdd={handleQuickAdd} />

          <div className="space-y-4">
            {rooms.map((room, rIdx) => {
              const formRoom = getValues(`rooms.${rIdx}`);
              const persistedRoomId =
                mode === "edit" ? formRoom?.id : undefined;
              return (
                <RoomCard
                  key={room.id}
                  roomIndex={rIdx}
                  onRemove={() => removeRoom(rIdx)}
                  curtainTypes={curtainTypes}
                  combos={combos}
                  mode={mode}
                  roomId={persistedRoomId}
                  photos={
                    persistedRoomId
                      ? (roomPhotos?.[persistedRoomId] ?? [])
                      : undefined
                  }
                />
              );
            })}
          </div>

          {rooms.length === 0 && (
            <div className="text-center py-8 text-sm text-slate-500">
              No rooms added yet. Use the quick add buttons above.
            </div>
          )}
          {errors.rooms?.message && (
            <p className="mt-2 text-xs text-red-600">{errors.rooms.message}</p>
          )}
        </section>

        <section className="bg-white rounded-lg border border-slate-200 p-4 sm:p-6 mb-4">
          <h2 className="text-base font-semibold text-slate-900 mb-3">
            General notes
          </h2>
          <textarea
            rows={3}
            placeholder="Site access instructions, customer preferences, delivery constraints…"
            className="w-full px-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:border-teal-500 bg-white"
            {...register("order.general_notes")}
          />
        </section>

        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 sm:gap-3 pb-12">
          <button
            type="button"
            onClick={handleCancel}
            disabled={pending}
            className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900"
          >
            Cancel
          </button>
          {mode === "create" && (
            <button
              type="button"
              onClick={saveAsDraft}
              disabled={pending}
              className="px-4 py-2 text-sm border border-slate-300 rounded hover:bg-slate-100 disabled:opacity-50"
            >
              Save as draft
            </button>
          )}
          <button
            type="submit"
            disabled={pending}
            className="px-5 py-2 text-sm bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 text-white rounded font-medium"
          >
            {pending
              ? mode === "edit"
                ? "Saving…"
                : "Creating…"
              : mode === "edit"
                ? "Save changes"
                : "Create order"}
          </button>
        </div>
      </form>
    </FormProvider>
  );
}
