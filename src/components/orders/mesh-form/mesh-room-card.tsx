"use client";

import { useFieldArray, useFormContext } from "react-hook-form";

import type { UploaderPhoto } from "@/components/orders/photo-uploader";
import {
  LineItemRow,
  RoomShell,
} from "@/components/orders/consultation-form/room-shell";
import type {
  MeshSystemBand,
  MeshSystemSpec,
} from "@/lib/orders/mesh-system";
import type { MeshPriceBook } from "@/lib/pricing/mesh-calculator";
import type { MeshCatalogueOption } from "@/lib/pricing/order-quote";
import type { MeshOrderEditInput } from "@/lib/validation/mesh";

import { MeshPanelFields } from "./mesh-panel-fields";

// The MESH room card. Owns the panels field array; RoomShell holds the room
// type, label, photos and remove button shared with curtains.
//
// There is no room-type sync effect here: the toilet/regular variant split is a
// curtain concept. A mesh panel is the same shape in every room.

type Props = {
  roomIndex: number;
  onRemove: () => void;
  categories: MeshCatalogueOption[];
  colours: MeshCatalogueOption[];
  systemBands: MeshSystemBand[];
  systemSpecs: MeshSystemSpec[];
  priceBook: MeshPriceBook;
  mode: "create" | "edit";
  roomId?: string;
  photos?: UploaderPhoto[];
};

export function MeshRoomCard({
  roomIndex,
  onRemove,
  categories,
  colours,
  systemBands,
  systemSpecs,
  priceBook,
  mode,
  roomId,
  photos,
}: Props) {
  const { control } = useFormContext<MeshOrderEditInput>();

  const { fields, append, remove } = useFieldArray({
    control,
    name: `rooms.${roomIndex}.panels`,
  });

  function addPanel() {
    append({
      position: fields.length,
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
    });
  }

  return (
    <RoomShell
      roomIndex={roomIndex}
      onRemove={onRemove}
      mode={mode}
      roomId={roomId}
      photos={photos}
      labelPlaceholder="e.g. Bedroom 1 (window facing corridor)"
    >
      {fields.map((field, pIdx) => (
        <LineItemRow
          key={field.id}
          label="Panel"
          index={pIdx}
          total={fields.length}
          onRemove={() => remove(pIdx)}
        >
          <MeshPanelFields
            roomIndex={roomIndex}
            panelIndex={pIdx}
            categories={categories}
            colours={colours}
            systemBands={systemBands}
            systemSpecs={systemSpecs}
            priceBook={priceBook}
          />
        </LineItemRow>
      ))}
      <button
        type="button"
        onClick={addPanel}
        className="text-xs text-teal-700 hover:text-teal-800 font-medium"
      >
        + Add another panel in this room
      </button>
    </RoomShell>
  );
}
