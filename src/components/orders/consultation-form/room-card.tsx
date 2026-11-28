"use client";

import { useEffect } from "react";
import { useFieldArray, useFormContext, useWatch } from "react-hook-form";

import {
  PendingPhotoUploader,
  ReadOnlyPhotoGallery,
  WindowPhotoUploader,
  type PendingUploaderPhoto,
  type UploaderPhoto,
} from "@/components/orders/photo-uploader";
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
  pendingPhotos?: PendingUploaderPhoto[];
  photosDisabled?: boolean;
  onAddPendingPhotos?: (files: File[]) => void;
  onRemovePendingPhoto?: (photoId: string) => void;
  /** windowId or template_window_id → persisted detail photos. */
  windowPhotos?: Record<string, UploaderPhoto[]>;
  /** client_key → detail photos still waiting for the window to persist. */
  pendingWindowPhotos?: Record<string, PendingUploaderPhoto[]>;
  onAddPendingWindowPhotos?: (windowKey: string, files: File[]) => void;
  onRemovePendingWindowPhoto?: (windowKey: string, photoId: string) => void;
  onDiscardWindowPending?: (windowKey: string) => void;
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
  pendingPhotos,
  photosDisabled,
  onAddPendingPhotos,
  onRemovePendingPhoto,
  windowPhotos,
  pendingWindowPhotos = {},
  onAddPendingWindowPhotos,
  onRemovePendingWindowPhoto,
  onDiscardWindowPending,
}: Props) {
  const { control, register, setValue, getValues } =
    useFormContext<OrderEditInput>();

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
      // A track-only window is valid in every non-toilet room, so it rides a
      // room-type change untouched — a toilet still forces it to blind.
      if (current === "blind" || (current === "track" && !isToilet)) return;
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
        // The saved drop is a curtain setting — a blind builds on the blind
        // allowance only.
        setValue(
          `rooms.${roomIndex}.windows.${i}.curtain_height_preference`,
          null,
          { shouldDirty: false },
        );
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

  // Pending detail photos key off client_key. If a value rewrite ever drops
  // the key on a window that has no server id yet, stamp a fresh one so the
  // uploader and the submit-time key→id map keep working. Keys are never
  // reassigned from another window — photos whose key was lost are discarded
  // at upload, never moved across windows or rooms.
  useEffect(() => {
    fields.forEach((_, i) => {
      const win = getValues(`rooms.${roomIndex}.windows.${i}`);
      if (win && !win.id && !win.client_key) {
        setValue(
          `rooms.${roomIndex}.windows.${i}.client_key`,
          crypto.randomUUID(),
          { shouldDirty: false, shouldValidate: false },
        );
      }
    });
  }, [roomIndex, fields, setValue, getValues]);

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
            label: "",
            client_key: crypto.randomUUID(),
            addon_ids: [],
            side_installation: false,
            no_installation: false,
          }
        : {
            variant: "regular",
            position: fields.length,
            day_curtain_type_id: "",
            night_curtain_type_id: "",
            draw: "Double",
            split_left_cm: null,
            split_right_cm: null,
            width_cm: null,
            height_cm: null,
            notes: "",
            label: "",
            client_key: crypto.randomUUID(),
            combo_id: "",
            addon_ids: [],
            side_installation: false,
            no_installation: false,
            overlap_tracks_attachment: false,
            curtain_height_preference: "default",
          },
    );
  }

  return (
    <RoomShell
      roomIndex={roomIndex}
      onRemove={onRemove}
      mode={mode}
      roomId={roomId}
      allowPendingPhotosOnCreate
      photos={photos}
      pendingPhotos={pendingPhotos}
      photosDisabled={photosDisabled}
      onAddPendingPhotos={onAddPendingPhotos}
      onRemovePendingPhoto={onRemovePendingPhoto}
    >
      {fields.map((field, wIdx) => {
        const win = getValues(`rooms.${roomIndex}.windows.${wIdx}`);
        const windowId = win?.id;
        // A seeded-but-unsaved window reads the source order's detail photos
        // read-only; the server clones the files it points at on save.
        const persistedPhotos = windowId
          ? (windowPhotos?.[windowId] ?? [])
          : (windowPhotos?.[win?.template_window_id ?? ""] ?? []);
        // client_key travels in the form values and feeds the submit-time
        // key→id map; field.id is useFieldArray's stable per-item key — the
        // fallback keeps the uploader attached during the single render
        // between a value rewrite dropping client_key and the effect above
        // stamping a fresh one.
        const pendingKey = windowId
          ? undefined
          : (win?.client_key ?? field.id);
        const pending = pendingKey ? (pendingWindowPhotos[pendingKey] ?? []) : [];
        return (
          <LineItemRow
            key={field.id}
            label="Window"
            index={wIdx}
            total={fields.length}
            onRemove={() => {
              if (pendingKey) onDiscardWindowPending?.(pendingKey);
              remove(wIdx);
            }}
            headingAside={
              <input
                type="text"
                aria-label="Window location label"
                placeholder="e.g. Bay window, left of door"
                maxLength={120}
                className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none"
                {...register(
                  `rooms.${roomIndex}.windows.${wIdx}.label`,
                )}
              />
            }
          >
            <WindowFields
              roomIndex={roomIndex}
              windowIndex={wIdx}
              isToilet={isToilet}
              curtainTypes={curtainTypes}
              combos={combos}
              addonCatalogue={addonCatalogue}
              persistedAddonIds={
                persistedAddonIdsByWindow[windowId ?? ""] ?? []
              }
            />
            <div className="mt-3 border-t border-slate-100 pt-3">
              <div className="mb-2 flex items-center justify-between gap-2 text-xs">
                <span className="font-medium text-slate-600">
                  Detail photos for this window
                </span>
                <span className="text-slate-400">
                  {windowId ? "Saved automatically" : "Uploads with order"}
                </span>
              </div>
              {windowId ? (
                <WindowPhotoUploader
                  windowId={windowId}
                  photos={persistedPhotos}
                />
              ) : (
                <>
                  {persistedPhotos.length > 0 && (
                    <div className="mb-3">
                      <ReadOnlyPhotoGallery photos={persistedPhotos} />
                    </div>
                  )}
                  {pendingKey &&
                  onAddPendingWindowPhotos &&
                  onRemovePendingWindowPhoto ? (
                    <PendingPhotoUploader
                      photos={pending}
                      disabled={photosDisabled}
                      onAdd={(files) =>
                        onAddPendingWindowPhotos(pendingKey, files)
                      }
                      onRemove={(photoId) =>
                        onRemovePendingWindowPhoto(pendingKey, photoId)
                      }
                    />
                  ) : (
                    <div className="rounded border-2 border-dashed border-slate-300 p-4 text-center text-xs text-slate-500">
                      Save changes once to create this window. After that,
                      photos save automatically.
                    </div>
                  )}
                </>
              )}
            </div>
          </LineItemRow>
        );
      })}
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
