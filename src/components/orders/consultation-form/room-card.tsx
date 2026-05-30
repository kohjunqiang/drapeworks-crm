"use client";

import { useEffect } from "react";
import {
  useFieldArray,
  useFormContext,
  useWatch,
} from "react-hook-form";

import { PhotoUploader, type UploaderPhoto } from "@/components/orders/photo-uploader";
import { isToiletRoom, type OrderEditInput } from "@/lib/validation/order";
import type { RoomType } from "@/lib/db/schema";

import { PhotoPlaceholder } from "./photo-placeholder";
import { WindowFields, type FabricOption } from "./window-fields";

const INPUT_CLS =
  "w-full px-2.5 py-1.5 border border-slate-200 rounded text-sm focus:outline-none focus:border-teal-500 bg-white";

const ROOM_TYPE_OPTIONS: RoomType[] = [
  "Living Room",
  "Master Bedroom",
  "Bedroom",
  "Master Toilet",
  "Common Toilet",
  "Kitchen",
  "Study Room",
  "Balcony",
  "Other",
];

type Props = {
  roomIndex: number;
  onRemove: () => void;
  fabrics: FabricOption[];
  mode: "create" | "edit";
  roomId?: string;
  photos?: UploaderPhoto[];
};

export function RoomCard({
  roomIndex,
  onRemove,
  fabrics,
  mode,
  roomId,
  photos,
}: Props) {
  const { register, control, setValue } = useFormContext<OrderEditInput>();

  const { fields, append, remove } = useFieldArray({
    control,
    name: `rooms.${roomIndex}.windows`,
  });

  const roomType = useWatch({
    control,
    name: `rooms.${roomIndex}.type`,
  });

  const isToilet = roomType ? isToiletRoom(roomType) : false;

  // Keep window variants in sync when the room type changes.
  useEffect(() => {
    if (!roomType) return;
    const targetVariant = isToilet ? "toilet" : "regular";
    fields.forEach((_, i) => {
      setValue(`rooms.${roomIndex}.windows.${i}.variant`, targetVariant, {
        shouldValidate: false,
        shouldDirty: false,
      });
      if (targetVariant === "toilet") {
        setValue(`rooms.${roomIndex}.windows.${i}.day_curtain_code`, "", {
          shouldDirty: false,
        });
        setValue(`rooms.${roomIndex}.windows.${i}.night_curtain_code`, "", {
          shouldDirty: false,
        });
        setValue(`rooms.${roomIndex}.windows.${i}.draw`, undefined, {
          shouldDirty: false,
        });
      } else {
        setValue(`rooms.${roomIndex}.windows.${i}.curtain_code`, "", {
          shouldDirty: false,
        });
      }
    });
  }, [roomType, isToilet, roomIndex, fields, setValue]);

  function addWindow() {
    append(
      isToilet
        ? {
            variant: "toilet",
            position: fields.length,
            curtain_code: "",
            width_cm: null,
            height_cm: null,
            install_width_cm: null,
            notes: "",
          }
        : {
            variant: "regular",
            position: fields.length,
            day_curtain_code: "",
            night_curtain_code: "",
            draw: "Double",
            width_cm: null,
            height_cm: null,
            install_width_cm: null,
            notes: "",
          },
    );
  }

  return (
    <div className="border border-slate-200 rounded-lg p-3 sm:p-4 bg-slate-50/50">
      <div className="flex items-start justify-between gap-2 sm:gap-3 mb-3">
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Room Type
            </label>
            <select
              className={INPUT_CLS}
              {...register(`rooms.${roomIndex}.type`)}
            >
              {ROOM_TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Room Label
            </label>
            <input
              type="text"
              className={INPUT_CLS}
              placeholder="e.g. Bedroom 1 (Nearest from Living)"
              {...register(`rooms.${roomIndex}.label`)}
            />
          </div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="text-slate-400 hover:text-red-600 text-xs sm:text-sm mt-6 whitespace-nowrap"
        >
          Remove
        </button>
      </div>

      <div className="space-y-3">
        {fields.map((field, wIdx) => (
          <div
            key={field.id}
            className="bg-white border border-slate-200 rounded p-3"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-700">
                {fields.length > 1 ? `Window ${wIdx + 1}` : "Window"}
              </span>
              {fields.length > 1 && (
                <button
                  type="button"
                  onClick={() => remove(wIdx)}
                  className="text-xs text-slate-400 hover:text-red-600"
                >
                  Remove window
                </button>
              )}
            </div>
            <WindowFields
              roomIndex={roomIndex}
              windowIndex={wIdx}
              isToilet={isToilet}
              fabrics={fabrics}
            />
          </div>
        ))}
        <button
          type="button"
          onClick={addWindow}
          className="text-xs text-teal-700 hover:text-teal-800 font-medium"
        >
          + Add another window in this room
        </button>
      </div>

      {mode === "edit" && roomId ? (
        <div className="mt-4 pt-3 border-t border-slate-200">
          <div className="text-xs font-medium text-slate-600 mb-2">
            Reference photos for this room
          </div>
          <PhotoUploader roomId={roomId} photos={photos ?? []} />
        </div>
      ) : mode === "edit" ? (
        <div className="mt-4 pt-3 border-t border-slate-200">
          <div className="border-2 border-dashed border-slate-300 rounded p-4 text-center text-xs text-slate-500">
            Save the order to add photos to this room.
          </div>
        </div>
      ) : (
        <PhotoPlaceholder />
      )}
    </div>
  );
}
