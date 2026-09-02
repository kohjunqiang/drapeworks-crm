"use client";

import { useFormContext, useWatch } from "react-hook-form";

import { FormSelect } from "@/components/ui/app-select";
import type { ActiveCombo } from "@/lib/db/combos";
import { formatSGD } from "@/lib/money";
import type { AddonRule } from "@/lib/orders/window-addons";
import type { OrderEditInput } from "@/lib/validation/order";

import { AddonCheckboxes } from "./addon-checkboxes";

export type CurtainTypeOption = {
  id: string;
  label: string;
  // Null for a blind. The day/night filters below compare against the literals,
  // so a blind never falls into either list even before the Blinds UI lands.
  category: "Day" | "Night" | null;
  productLine: "curtain" | "blind";
  photoUrl: string | null;
  costRmbCents: number | null;
  saleSgdCents: number | null;
  // Series name alone, for the live quote's cost breakdown.
  seriesName: string | null;
};

const INPUT_CLS =
  "w-full px-2.5 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:border-teal-500 bg-white";

type Props = {
  roomIndex: number;
  windowIndex: number;
  /** Since Phase 14 this means "this window is a blind" — no curtain on offer. */
  isToilet: boolean;
  curtainTypes: CurtainTypeOption[];
  combos: ActiveCombo[];
  addonCatalogue: AddonRule[];
  /** What this window's add-ons were on load. Empty for a new window. */
  persistedAddonIds: string[];
};

// A native <select> truncates long option labels on narrow screens and can't
// render option images, so once a curtain is chosen we show a preview row
// beneath the control: a thumbnail plus the full, wrapping label. Renders
// nothing until something is selected, so empty windows stay uncluttered.
function Preview({
  options,
  selectedId,
}: {
  options: CurtainTypeOption[];
  selectedId: string | undefined;
}) {
  const opt = selectedId ? options.find((o) => o.id === selectedId) : undefined;
  if (!opt) return null;
  return (
    <div className="mt-1.5 flex items-center gap-2 rounded border border-slate-100 bg-slate-50 p-1.5">
      <div className="w-10 h-10 flex-shrink-0 rounded border border-slate-200 bg-slate-100 overflow-hidden flex items-center justify-center text-slate-300">
        {opt.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={opt.photoUrl}
            alt={opt.label}
            className="w-full h-full object-cover"
          />
        ) : (
          // Placeholder image icon — reads as "no photo yet", not a broken box.
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
            />
          </svg>
        )}
      </div>
      <span className="text-xs leading-snug text-slate-600">{opt.label}</span>
    </div>
  );
}

// Curtains / Blinds segmented control. A window is one or the other — never
// both — so this is a two-way switch rather than a pair of checkboxes.
function CoveringToggle({
  isBlind,
  onChange,
  blindsAvailable,
}: {
  isBlind: boolean;
  onChange: (next: "curtain" | "blind") => void;
  blindsAvailable: boolean;
}) {
  // With no priced blind in the catalogue the toggle would lead to an empty
  // picker, so it stays hidden until an admin has added one — the same "don't
  // offer what can't be quoted" rule the Mesh card follows on the product
  // chooser.
  //
  // A window that already IS a blind is the exception: hiding the toggle there
  // strands it on the blind layout with no way back to curtains. That is
  // reachable in practice — a recovered draft (or an order saved while blinds
  // were priced) can hold a blind window after the prices come off. The way out
  // must never depend on the catalogue.
  if (!blindsAvailable && !isBlind) return null;

  const cls = (active: boolean) =>
    active
      ? "px-3 py-1 text-xs font-medium rounded bg-white text-slate-900 shadow-sm"
      : "px-3 py-1 text-xs text-slate-500 hover:text-slate-700";

  // The escape-hatch case above: this window is a blind, but no blind can be
  // quoted any more. Say so, since switching away is one-way — once it's a
  // curtain the toggle disappears again.
  const stranded = isBlind && !blindsAvailable;

  return (
    <div className="col-span-2 sm:col-span-6">
      <div
        role="group"
        aria-label="Window covering"
        className="inline-flex gap-0.5 rounded-md bg-slate-100 p-0.5"
      >
        <button
          type="button"
          aria-pressed={!isBlind}
          onClick={() => onChange("curtain")}
          className={cls(!isBlind)}
        >
          Curtains
        </button>
        <button
          type="button"
          aria-pressed={isBlind}
          onClick={() => onChange("blind")}
          className={cls(isBlind)}
        >
          Blinds
        </button>
      </div>
      {stranded && (
        <p className="mt-1 text-xs text-amber-700">
          ⚠ No blind has a sale price, so this window can&rsquo;t be quoted.
          Switch it to Curtains, or price a blind series under Product →
          Blinds.
        </p>
      )}
    </div>
  );
}

export function WindowFields({
  roomIndex,
  windowIndex,
  isToilet,
  curtainTypes,
  combos,
  addonCatalogue,
  persistedAddonIds,
}: Props) {
  const { register, control, setValue, getValues } =
    useFormContext<OrderEditInput>();
  const base = `rooms.${roomIndex}.windows.${windowIndex}` as const;
  const variant = useWatch({ control, name: `${base}.variant` });
  const isBlind = variant === "blind";

  // Switching covering clears the other side's selections. Measurements and
  // notes survive — they describe the OPENING, not what hangs in it.
  //
  // draw survives too, but its meaning changes: on a curtain it is the pull
  // direction, on a blind the chain/control side. "Double" has no blind
  // equivalent, so it is cleared rather than silently reinterpreted.
  function setCovering(next: "curtain" | "blind") {
    // Add-ons that no longer apply are dropped on the switch, mirroring how the
    // day/night selections already are. The resolver would hide them by scope
    // anyway, but leaving them in form state means resubmitting them on every
    // save for the server to discard.
    setValue(`${base}.addon_ids`, [], { shouldDirty: true });
    if (next === "blind") {
      if (getValues(`${base}.draw`) === "Double") {
        setValue(`${base}.draw`, undefined, { shouldDirty: true });
      }
      setValue(`${base}.variant`, "blind", { shouldDirty: true });
      return;
    }
    setValue(`${base}.variant`, "regular", { shouldDirty: true });
  }

  // Every curtain picker takes curtain-line options only. The day/night
  // filters would exclude a blind anyway (its category is null); this keeps
  // the intent explicit rather than relying on that.
  const curtainOptions = curtainTypes.filter(
    (c) => c.productLine === "curtain",
  );
  // PRICED blinds only. An unpriced blind would quote at S$0 sale while still
  // charging the blinds install rate — a silently negative margin — so it is
  // never offered. This is also what gates the Curtains/Blinds toggle: with no
  // priced blind in the catalogue there is nothing to switch to, and the toggle
  // stays hidden. Same "don't offer what can't be quoted" rule as the Mesh card.
  const blindOptions = curtainTypes.filter(
    (c) => c.productLine === "blind" && c.saleSgdCents != null,
  );
  const dayTypes = curtainOptions.filter((c) => c.category === "Day");
  const nightTypes = curtainOptions.filter((c) => c.category === "Night");

  const dayId = useWatch({ control, name: `${base}.day_curtain_type_id` });
  const nightId = useWatch({ control, name: `${base}.night_curtain_type_id` });
  const blindId = useWatch({ control, name: `${base}.blind_type_id` });
  const comboId = useWatch({ control, name: `${base}.combo_id` });
  const activeCombo = comboId
    ? combos.find((c) => c.id === comboId)
    : undefined;

  if (isBlind) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
        {/* A toilet window is a blind — there is nothing to toggle to. */}
        {!isToilet && (
          <CoveringToggle
            isBlind
            onChange={setCovering}
            blindsAvailable={blindOptions.length > 0}
          />
        )}
        {isToilet && blindOptions.length === 0 && (
          // The toggle normally carries this warning, and it is hidden here, so
          // the branch has to say it itself: don't offer what can't be quoted.
          <p className="col-span-2 sm:col-span-6 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            ⚠ No blind has a sale price, so this window can&rsquo;t be quoted.
            Price a blind series under Product → Blinds.
          </p>
        )}
        <div className="col-span-2 sm:col-span-4">
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Blind
          </label>
          <FormSelect
            control={control}
            name={`${base}.blind_type_id`}
            noneLabel="— Select —"
            options={blindOptions.map((c) => ({
              value: c.id,
              label: c.label,
            }))}
          />
          <Preview options={blindOptions} selectedId={blindId} />
        </div>
        <div className="col-span-2 sm:col-span-2">
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Control side
          </label>
          {/* Same `draw` column as a curtain, but a blind has one chain — there
              is no "Double". */}
          <FormSelect
            control={control}
            name={`${base}.draw`}
            noneLabel="— Select —"
            options={[
              { value: "Single Left", label: "Left" },
              { value: "Single Right", label: "Right" },
            ]}
          />
        </div>
        <div className="sm:col-span-3">
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Width (cm)
          </label>
          <input
            type="number"
            className={INPUT_CLS}
            {...register(`${base}.width_cm`)}
          />
        </div>
        <div className="sm:col-span-3">
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Height (cm)
          </label>
          <input
            type="number"
            className={INPUT_CLS}
            {...register(`${base}.height_cm`)}
          />
        </div>
        <AddonCheckboxes
          roomIndex={roomIndex}
          windowIndex={windowIndex}
          covering="blind"
          catalogue={addonCatalogue}
          persistedIds={persistedAddonIds}
        />
        <div className="col-span-2 sm:col-span-6">
          <label
            htmlFor={`room-${roomIndex}-window-${windowIndex}-installation-note`}
            className="block text-xs font-medium text-slate-600 mb-1"
          >
            Installation note
          </label>
          <input
            id={`room-${roomIndex}-window-${windowIndex}-installation-note`}
            type="text"
            placeholder="e.g. inside mount, bracket clearance…"
            className={INPUT_CLS}
            {...register(`${base}.notes`)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
      <CoveringToggle
        isBlind={false}
        onChange={setCovering}
        blindsAvailable={blindOptions.length > 0}
      />
      <div className="col-span-2 sm:col-span-3">
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Day Curtain
        </label>
        <FormSelect
          control={control}
          name={`${base}.day_curtain_type_id`}
          noneLabel="— None —"
          options={dayTypes.map((c) => ({ value: c.id, label: c.label }))}
        />
        <Preview options={dayTypes} selectedId={dayId} />
      </div>
      <div className="col-span-2 sm:col-span-3">
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Night Curtain
        </label>
        <FormSelect
          control={control}
          name={`${base}.night_curtain_type_id`}
          noneLabel="— None —"
          options={nightTypes.map((c) => ({ value: c.id, label: c.label }))}
        />
        <Preview options={nightTypes} selectedId={nightId} />
      </div>
      <div className="sm:col-span-2">
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Width (cm)
        </label>
        <input
          type="number"
          className={INPUT_CLS}
          {...register(`${base}.width_cm`)}
        />
      </div>
      <div className="sm:col-span-2">
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Height (cm)
        </label>
        <input
          type="number"
          className={INPUT_CLS}
          {...register(`${base}.height_cm`)}
        />
      </div>
      <div className="col-span-2 sm:col-span-2">
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Draw
        </label>
        <FormSelect
          control={control}
          name={`${base}.draw`}
          options={[
            { value: "Double", label: "Double" },
            { value: "Single Left", label: "Single Left" },
            { value: "Single Right", label: "Single Right" },
          ]}
        />
      </div>
      <AddonCheckboxes
        roomIndex={roomIndex}
        windowIndex={windowIndex}
        covering="curtain"
        catalogue={addonCatalogue}
        persistedIds={persistedAddonIds}
      />
      {combos.length > 0 && (
        <div className="col-span-2 sm:col-span-3">
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Combo bundle
          </label>
          <FormSelect
            control={control}
            name={`${base}.combo_id`}
            noneLabel="— None —"
            options={combos.map((c) => ({
              value: c.id,
              label: `${c.name} — ${formatSGD(c.priceSgdCents)}`,
            }))}
          />
          {activeCombo && (
            <p className="mt-1.5 inline-flex items-center gap-1 rounded bg-amber-50 border border-amber-200 px-2 py-1 text-xs text-amber-800">
              🏷 {activeCombo.name} — {formatSGD(activeCombo.priceSgdCents)}
              /window <span className="text-amber-600">(overrides calc)</span>
            </p>
          )}
        </div>
      )}
      <div className="col-span-2 sm:col-span-4">
        <label
          htmlFor={`room-${roomIndex}-window-${windowIndex}-installation-note`}
          className="block text-xs font-medium text-slate-600 mb-1"
        >
          Installation note
        </label>
        <input
          id={`room-${roomIndex}-window-${windowIndex}-installation-note`}
          type="text"
          placeholder="e.g. ceiling mount, beam clearance…"
          className={INPUT_CLS}
          {...register(`${base}.notes`)}
        />
      </div>
    </div>
  );
}
