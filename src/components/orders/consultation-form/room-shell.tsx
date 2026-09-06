"use client";

import type { ReactNode } from "react";
import { useFormContext } from "react-hook-form";

import {
  PendingPhotoUploader,
  PhotoUploader,
  ReadOnlyPhotoGallery,
  type PendingUploaderPhoto,
  type UploaderPhoto,
} from "@/components/orders/photo-uploader";
import { FormSelect } from "@/components/ui/app-select";
import type { RoomType } from "@/lib/db/schema";

import type { RoomShellShape } from "./form-shapes";
import { PhotoPlaceholder } from "./photo-placeholder";

// Everything a room card has that isn't its line items: the room type select,
// the label, the remove button, and the photo section. Typed to RoomShellShape
// — the fields every product line's rooms have — so it doesn't claim to know
// whether the room holds windows or mesh panels.
//
// Each product's room card supplies its own useFieldArray and rows as children.

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
  "Service Yard",
  "Other",
];

type Props = {
  roomIndex: number;
  onRemove: () => void;
  mode: "create" | "edit";
  roomId?: string;
  photos?: UploaderPhoto[];
  pendingPhotos?: PendingUploaderPhoto[];
  photosDisabled?: boolean;
  onAddPendingPhotos?: (files: File[]) => void;
  onRemovePendingPhoto?: (photoId: string) => void;
  labelPlaceholder?: string;
  children: ReactNode;
};

export function RoomShell({
  roomIndex,
  onRemove,
  mode,
  roomId,
  photos,
  pendingPhotos = [],
  photosDisabled = false,
  onAddPendingPhotos,
  onRemovePendingPhoto,
  labelPlaceholder = "e.g. Bedroom 1 (Nearest from Living)",
  children,
}: Props) {
  const { control, register } = useFormContext<RoomShellShape>();

  return (
    <div className="border border-slate-200 rounded-lg p-3 sm:p-4 bg-slate-50/50">
      <div className="flex items-start justify-between gap-2 sm:gap-3 mb-3">
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Room Type
            </label>
            <FormSelect
              control={control}
              name={`rooms.${roomIndex}.type`}
              options={ROOM_TYPE_OPTIONS.map((t) => ({ value: t, label: t }))}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Room Label
            </label>
            <input
              type="text"
              className={INPUT_CLS}
              placeholder={labelPlaceholder}
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

      <div className="space-y-3">{children}</div>

      {mode === "edit" && roomId ? (
        <div className="mt-4 pt-3 border-t border-slate-200">
          <div className="mb-2 flex items-center justify-between gap-2 text-xs">
            <span className="font-medium text-slate-600">
              Reference photos for this room
            </span>
            <span className="text-slate-400">Saved automatically</span>
          </div>
          <PhotoUploader roomId={roomId} photos={photos ?? []} />
          {pendingPhotos.length > 0 &&
            onAddPendingPhotos &&
            onRemovePendingPhoto && (
              <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-3">
                <p className="mb-2 text-xs text-amber-800">
                  These photos did not upload. Save changes to retry.
                </p>
                <PendingPhotoUploader
                  photos={pendingPhotos}
                  disabled={photosDisabled}
                  onAdd={onAddPendingPhotos}
                  onRemove={onRemovePendingPhoto}
                />
              </div>
            )}
        </div>
      ) : mode === "edit" ? (
        <div className="mt-4 pt-3 border-t border-slate-200">
          <div className="mb-2 flex items-center justify-between gap-2 text-xs">
            <span className="font-medium text-slate-600">
              Reference photos for this room
            </span>
            <span className="text-slate-400">Uploads with order</span>
          </div>
          {onAddPendingPhotos && onRemovePendingPhoto ? (
            <PendingPhotoUploader
              photos={pendingPhotos}
              disabled={photosDisabled}
              onAdd={onAddPendingPhotos}
              onRemove={onRemovePendingPhoto}
            />
          ) : (
            <div className="rounded border-2 border-dashed border-slate-300 p-4 text-center text-xs text-slate-500">
              Save changes once to create this room. After that, photos save
              automatically.
            </div>
          )}
        </div>
      ) : (photos?.length ?? 0) > 0 ? (
        <div className="mt-4 border-t border-slate-200 pt-3">
          <div className="mb-2 flex items-center justify-between gap-2 text-xs">
            <span className="font-medium text-slate-600">
              Reference photos for this room
            </span>
            <span className="text-slate-400">Copied with new order</span>
          </div>
          <ReadOnlyPhotoGallery photos={photos ?? []} />
        </div>
      ) : (
        <PhotoPlaceholder />
      )}
    </div>
  );
}

/** A single line item row: numbered header + remove control + fields. */
export function LineItemRow({
  label,
  index,
  total,
  onRemove,
  children,
}: {
  label: string;
  index: number;
  total: number;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-slate-700">
          {total > 1 ? `${label} ${index + 1}` : label}
        </span>
        {total > 1 && (
          <button
            type="button"
            onClick={onRemove}
            className="text-xs text-slate-400 hover:text-red-600"
          >
            Remove {label.toLowerCase()}
          </button>
        )}
      </div>
      {children}
    </div>
  );
}
