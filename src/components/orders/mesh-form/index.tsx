"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { FormProvider, useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { CustomerSection } from "@/components/orders/consultation-form/customer-section";
import {
  formDraftKey,
  useFormDraft,
} from "@/components/orders/consultation-form/use-form-draft";
import { PricingSection } from "@/components/orders/consultation-form/pricing-section";
import {
  QuickAddRoomBar,
  type RoomTemplate,
} from "@/components/orders/consultation-form/quick-add-room-bar";
import type { UploaderPhoto } from "@/components/orders/photo-uploader";
import {
  createMeshOrder,
  createMeshOrderDraft,
  updateMeshOrder,
} from "@/lib/actions/mesh-orders";
import type { ActivePromotion } from "@/lib/db/promotions";
import {
  meshSystemProblems,
  type MeshSystemBand,
  type MeshSystemSpec,
} from "@/lib/orders/mesh-system";
import type { MeshCalcConfig } from "@/lib/pricing/order-quote";
import {
  meshOrderCreateSchema,
  meshOrderEditSchema,
  type MeshOrderEditInput,
} from "@/lib/validation/mesh";

import { MeshLiveQuote } from "./mesh-live-quote";
import { MeshRoomCard } from "./mesh-room-card";

// The MESH consultation form. Parallel to ConsultationForm rather than a branch
// inside it: the schemas, actions, line items and quote engine all differ,
// while the customer, pricing, room-shell and quick-add pieces are imported and
// genuinely shared.

type Mode = "create" | "edit";

type Props = {
  mode: Mode;
  meshConfig: MeshCalcConfig;
  // The track-system matrix (§5.9). Kept separate from meshConfig because it is
  // a fabrication spec, not a pricing input — nothing here reaches the quote.
  systemBands: MeshSystemBand[];
  systemSpecs: MeshSystemSpec[];
  promotions?: ActivePromotion[];
  orderId?: string;
  defaultValues?: MeshOrderEditInput;
  roomPhotos?: Record<string, UploaderPhoto[]>;
};

function makePanel(position: number) {
  return {
    position,
    category_id: "",
    colour_id: "",
    width_cm: null,
    height_cm: null,
    has_window: true,
    has_inset_horizontal: false,
    has_inset_vertical: false,
    draw: undefined,
    split_left_cm: null,
    split_right_cm: null,
    notes: "",
  };
}

const EMPTY_DEFAULTS: MeshOrderEditInput = {
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
    curtain_package_id: "",
    curtain_package_tier: "essential",
    curtain_package_single_layer: "night",
  },
  rooms: [
    {
      type: "Living Room",
      label: "Living Room",
      position: 0,
      panels: [makePanel(0)],
    },
  ],
};

export function MeshConsultationForm({
  mode,
  meshConfig,
  systemBands,
  systemSpecs,
  promotions = [],
  orderId,
  defaultValues,
  roomPhotos,
}: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const schema =
    mode === "create" ? meshOrderCreateSchema : meshOrderEditSchema;
  const initial = defaultValues ?? EMPTY_DEFAULTS;

  const form = useForm<MeshOrderEditInput>({
    // Same reasoning as the curtain form: the Zod transforms make the output
    // shape diverge from the input shape, which is fine at runtime but not
    // statically reconcilable without threading transform types everywhere.
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
    formDraftKey("mesh", mode, orderId),
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
      panels: [makePanel(0)],
    });
  }

  // Positions are re-derived from array order on submit so a removed row never
  // leaves a gap the factory sheet would render as a missing panel.
  function normalise(values: MeshOrderEditInput): MeshOrderEditInput {
    return {
      ...values,
      rooms: (values.rooms ?? []).map((room, rIdx) => ({
        ...room,
        position: rIdx,
        panels: (room.panels ?? []).map((p, pIdx) => ({
          ...p,
          position: pIdx,
        })),
      })),
    };
  }

  function runAction(fn: () => Promise<unknown>, failMsg: string) {
    startTransition(async () => {
      try {
        await fn();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        // A server action redirect throws by design; it isn't a failure — it is
        // in fact the only success signal, so the recovery draft is dropped
        // here rather than before the call.
        if (msg === "NEXT_REDIRECT" || msg.includes("NEXT_REDIRECT")) {
          clearDraft();
          return;
        }
        toast.error(msg || failMsg);
      }
    });
  }

  const onSubmit = handleSubmit((values) => {
    const payload = normalise(values);

    // An unbuildable panel blocks the save. The server action performs the same
    // check — that is the guarantee — but catching it here names the room and
    // panel instead of surfacing a bare action error after a round trip.
    const problems = meshSystemProblems(
      (payload.rooms ?? []).map((r) => ({
        panels: (r.panels ?? []).map((p) => ({
          widthCm: p.width_cm ?? null,
          draw: p.draw,
        })),
      })),
      systemBands,
    );
    if (problems.length > 0) {
      const p = problems[0];
      const room = payload.rooms?.[p.roomIndex];
      toast.error(
        `${room?.label ?? `Room ${p.roomIndex + 1}`}, panel ${
          p.panelIndex + 1
        }: ${p.message}`,
      );
      return;
    }

    runAction(() => {
      if (mode === "edit") {
        if (!orderId) throw new Error("Missing order id for edit");
        return updateMeshOrder(orderId, payload);
      }
      return createMeshOrder(payload);
    }, "Save failed");
  });

  function saveAsDraft() {
    // Raw current values — skip the strict resolver so partial input is
    // allowed. The draft action does its own relaxed validation.
    runAction(
      () => createMeshOrderDraft(normalise(getValues())),
      "Draft save failed",
    );
  }

  function handleCancel() {
    if (mode === "edit" && orderId) router.push(`/orders/${orderId}`);
    else router.back();
  }

  return (
    <FormProvider {...form}>
      <form onSubmit={onSubmit}>
        <CustomerSection />
        <PricingSection promotions={promotions} />

        <MeshLiveQuote config={meshConfig} />

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
            <span className="text-xs text-slate-500">
              {rooms.length} {rooms.length === 1 ? "room" : "rooms"}
            </span>
          </div>

          <QuickAddRoomBar onAdd={handleQuickAdd} />

          <div className="space-y-4">
            {rooms.map((room, rIdx) => {
              const formRoom = getValues(`rooms.${rIdx}`);
              const persistedRoomId =
                mode === "edit" ? formRoom?.id : undefined;
              return (
                <MeshRoomCard
                  key={room.id}
                  roomIndex={rIdx}
                  onRemove={() => removeRoom(rIdx)}
                  categories={meshConfig.categories}
                  colours={meshConfig.colours}
                  systemBands={systemBands}
                  systemSpecs={systemSpecs}
                  priceBook={meshConfig.book}
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
                : "Create mesh order"}
          </button>
        </div>
      </form>
    </FormProvider>
  );
}
