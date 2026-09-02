"use client";

import { useEffect } from "react";
import { useFieldArray, useFormContext, useWatch } from "react-hook-form";

import type { UploaderPhoto } from "@/components/orders/photo-uploader";
import type { AddonRule } from "@/lib/orders/window-addons";
import { isToiletRoom, type OrderEditInput } from "@/lib/validation/order";

import type { ActiveCombo } from "@/lib/db/combos";

import { LineItemRow, RoomShell } from "./room-shell";
import { WindowFields, type CurtainTypeOption } from "./window-fields";

// The CURTAIN room card. Owns the windows field array and the blind-variant
// sync effect — both curtain-specific — while RoomShell holds the room type,
// label, photos and remove button that every product line shares.
//
// This keeps useFormContext bound to OrderEditInput here, where that is
// actually true, instead of in a shared component where it would be a lie for
// mesh rooms.

type Props = {
  roomIndex: number;
  onRemove: () => void;
  curtainTypes: CurtainTypeOption[];
  combos: ActiveCombo[];
  addonCatalogue: AddonRule[];
  /** windowId → the add-on ids that window had on load. */
  persistedAddonIdsByWindow: Record<string, string[]>;
  mode: "create" | "edit";
  roomId?: string;
  photos?: UploaderPhoto[];
};

export function RoomCard({
  roomIndex,
  onRemove,
  curtainTypes,
  combos,
  addonCatalogue,
  persistedAddonIdsByWindow,
  mode,
  roomId,
  photos,
}: Props) {
  const { control, setValue, getValues } = useFormContext<OrderEditInput>();

  const { fields, append, remove } = useFieldArray({
    control,
    name: `rooms.${roomIndex}.windows`,
  });

  const roomType = useWatch({ control, name: `rooms.${roomIndex}.type` });

  const isToilet = roomType ? isToiletRoom(roomType) : false;

  // Keep window variants in sync when the room type changes.
  //
  // Blind windows are skipped entirely: a blind is valid in every room type, so
  // there is nothing to re-derive, and rewriting its variant here would wipe
  // the chosen blind the moment someone corrected the room type. This mirrors
  // the same carve-out in saveDraft on the server.
  useEffect(() => {
    if (!roomType) return;
    // A toilet room's windows are blinds (Phase 14).
    const targetVariant = isToilet ? "blind" : "regular";
    fields.forEach((_, i) => {
      const current = getValues(`rooms.${roomIndex}.windows.${i}.variant`);
      if (current === "blind") return;
      setValue(`rooms.${roomIndex}.windows.${i}.variant`, targetVariant, {
        shouldValidate: false,
        shouldDirty: false,
      });
      if (targetVariant === "blind") {
        setValue(`rooms.${roomIndex}.windows.${i}.day_curtain_type_id`, "", {
          shouldDirty: false,
        });
        setValue(`rooms.${roomIndex}.windows.${i}.night_curtain_type_id`, "", {
          shouldDirty: false,
        });
        setValue(`rooms.${roomIndex}.windows.${i}.combo_id`, "", {
          shouldDirty: false,
        });
        // "Double" is a curtain pull direction with no blind equivalent.
        if (getValues(`rooms.${roomIndex}.windows.${i}.draw`) === "Double") {
          setValue(`rooms.${roomIndex}.windows.${i}.draw`, undefined, {
            shouldDirty: false,
          });
        }
        // Curtain add-ons don't survive the change of covering.
        setValue(`rooms.${roomIndex}.windows.${i}.addon_ids`, [], {
          shouldDirty: false,
        });
      }
    });
  }, [roomType, isToilet, roomIndex, fields, setValue, getValues]);

  function addWindow() {
    append(
      isToilet
        ? {
            variant: "blind",
            position: fields.length,
            blind_type_id: "",
            width_cm: null,
            height_cm: null,
            notes: "",
            addon_ids: [],
            side_installation: false,
          }
        : {
            variant: "regular",
            position: fields.length,
            day_curtain_type_id: "",
            night_curtain_type_id: "",
            draw: "Double",
            width_cm: null,
            height_cm: null,
            notes: "",
            combo_id: "",
            addon_ids: [],
            side_installation: false,
          },
    );
  }

  return (
    <RoomShell
      roomIndex={roomIndex}
      onRemove={onRemove}
      mode={mode}
      roomId={roomId}
      photos={photos}
    >
      {fields.map((field, wIdx) => (
        <LineItemRow
          key={field.id}
          label="Window"
          index={wIdx}
          total={fields.length}
          onRemove={() => remove(wIdx)}
        >
          <WindowFields
            roomIndex={roomIndex}
            windowIndex={wIdx}
            isToilet={isToilet}
            curtainTypes={curtainTypes}
            combos={combos}
            addonCatalogue={addonCatalogue}
            persistedAddonIds={
              persistedAddonIdsByWindow[
                getValues(`rooms.${roomIndex}.windows.${wIdx}.id`) ?? ""
              ] ?? []
            }
          />
        </LineItemRow>
      ))}
      <button
        type="button"
        onClick={addWindow}
        className="text-xs text-teal-700 hover:text-teal-800 font-medium"
      >
        + Add another window in this room
      </button>
    </RoomShell>
  );
}
