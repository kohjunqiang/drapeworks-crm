"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  savePoOpeningLabel,
  savePoTypeLabel,
  saveRoomTypeLabel,
  saveSeriesNameCn,
} from "@/lib/actions/procurement";
import type {
  BlindSeriesNameRow,
  PoOpeningLabelRow,
  PoTypeLabelRow,
  RoomTypeLabelRow,
} from "@/lib/db/procurement";
import { ROOM_TYPE_VALUES } from "@/lib/validation/order";
import {
  containsChinese,
  PO_TYPE_KEYS,
  type PoTypeKey,
} from "@/lib/validation/procurement";

// The section that unblocks PO generation, and the reason anyone opens this
// page. Every field here ends up in a cell of a 采购订单 on a factory floor in
// Shenzhen; a blank one is a cutting instruction nobody can follow, so the
// generator refuses while any of them is missing and this is the only place
// they can be supplied.
//
// NOTHING IS PRE-FILLED BY US. Only three strings in the whole table are known
// — 纱窗 Day, 窗帘 Night and 对开 Double draw, transcribed off the sample PDFs.
// The rest are questions for a Chinese-speaking human at the business.

const INPUT =
  "w-full px-3 py-2 border border-slate-200 rounded text-sm bg-white " +
  "focus:outline-none focus:border-teal-500";

/** English gloss for each 窗帘款式 key, so an admin knows what they are naming. */
const TYPE_KEY_LABELS: Record<PoTypeKey, string> = {
  day: "Day curtain",
  night: "Night curtain",
  blind: "Blind (fallback)",
  mesh: "Mesh panel",
};

const TYPE_KEY_HINTS: Record<PoTypeKey, string> = {
  day: "Every row of the Day sample PO.",
  night: "Every row of the Night sample PO.",
  blind: "Used only when a blind's series has no Chinese name of its own.",
  mesh: "Mesh panels are not on any sample PO yet.",
};

const BLIND_CONTROL_TITLES: Record<string, string> = {
  "Blind Pulley Left": "Pulley left",
  "Blind Pulley Right": "Pulley right",
};

type RowKind = "room" | "type" | "opening" | "series";

type LabelRow = {
  kind: RowKind;
  /** room_type · po_type_labels.key · po_opening_labels.draw · series id. */
  id: string;
  title: string;
  hint?: string;
  /** The Chinese as stored. Null means nobody has told us. */
  cn: string | null;
  /** Room rows only — the Latin code, e.g. LR. */
  code?: string;
};

type Draft = Record<string, string>;

const cnKey = (r: { kind: RowKind; id: string }) => `${r.kind}:${r.id}`;
const codeKey = (id: string) => `code:${id}`;

function StatusBadge({ value }: { value: string }) {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return (
      <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-red-50 text-red-700 whitespace-nowrap">
        Not set
      </span>
    );
  }
  // A label holding only Latin text is the shape that used to slip through:
  // Service Yard stored the English words "Service Yard", and they would have
  // printed on a Chinese document. Flagged, never blocked — 窗帘 Night is a
  // legitimate mix and every sample row prints it that way.
  if (!containsChinese(trimmed)) {
    return (
      <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-800 whitespace-nowrap">
        No 中文
      </span>
    );
  }
  return (
    <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-teal-50 text-teal-700 whitespace-nowrap">
      Set
    </span>
  );
}

// Hoisted to module scope on purpose. Defined inside the panel these would be a
// new component type on every render, so React would unmount the input the
// admin is typing into and the field would lose focus each keystroke.
function LabelRowFields({
  row,
  draft,
  onChange,
}: {
  row: LabelRow;
  draft: Draft;
  onChange: (key: string, value: string) => void;
}) {
  const k = cnKey(row);
  const cn = draft[k] ?? "";
  return (
    <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-3 sm:items-center">
      <div className="sm:col-span-4 min-w-0">
        <div className="text-sm font-medium text-slate-900">{row.title}</div>
        {row.hint && (
          <div className="text-xs text-slate-500 mt-0.5">{row.hint}</div>
        )}
      </div>
      <div className={row.kind === "room" ? "sm:col-span-4" : "sm:col-span-6"}>
        <input
          aria-label={`${row.title} — Chinese (中文)`}
          lang="zh"
          placeholder="中文"
          className={INPUT}
          value={cn}
          onChange={(e) => onChange(k, e.target.value)}
        />
      </div>
      {row.kind === "room" && (
        <div className="sm:col-span-2">
          <input
            aria-label={`${row.title} — code`}
            placeholder="Code, e.g. LR"
            className={INPUT}
            value={draft[codeKey(row.id)] ?? ""}
            onChange={(e) => onChange(codeKey(row.id), e.target.value)}
          />
        </div>
      )}
      <div className="sm:col-span-2 sm:text-right">
        <StatusBadge value={cn} />
      </div>
    </div>
  );
}

function LabelGroup({
  title,
  description,
  rows,
  draft,
  onChange,
}: {
  title: string;
  description: string;
  rows: LabelRow[];
  draft: Draft;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <div className="border-t border-slate-200">
      <div className="px-4 py-3 bg-slate-50">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <p className="text-xs text-slate-500 mt-0.5">{description}</p>
      </div>
      <div className="divide-y divide-slate-100">
        {rows.map((row) => (
          <LabelRowFields
            key={cnKey(row)}
            row={row}
            draft={draft}
            onChange={onChange}
          />
        ))}
        {rows.length === 0 && (
          <div className="px-4 py-6 text-sm text-slate-500">Nothing here.</div>
        )}
      </div>
    </div>
  );
}

export function PoLabelsPanel({
  roomLabels,
  typeLabels,
  openingLabels,
  blindSeries,
}: {
  roomLabels: RoomTypeLabelRow[];
  typeLabels: PoTypeLabelRow[];
  openingLabels: PoOpeningLabelRow[];
  blindSeries: BlindSeriesNameRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Every room type the CRM can record, not just the ones with a row. Six have
  // none, and a room type with no row blocks generation exactly as loudly as
  // one with a null name — so both have to be visible and fixable here.
  const rooms: LabelRow[] = useMemo(() => {
    const byType = new Map(roomLabels.map((r) => [r.room_type, r]));
    return ROOM_TYPE_VALUES.map((roomType) => {
      const row = byType.get(roomType);
      return {
        kind: "room" as const,
        id: roomType,
        title: roomType,
        cn: row?.name_cn ?? null,
        code: row?.code ?? "",
        hint: row == null ? "No row yet — saving creates one." : undefined,
      };
    });
  }, [roomLabels]);

  const types: LabelRow[] = useMemo(() => {
    const byKey = new Map(typeLabels.map((r) => [r.key, r]));
    return PO_TYPE_KEYS.map((key) => ({
      kind: "type" as const,
      id: key,
      title: TYPE_KEY_LABELS[key],
      hint: TYPE_KEY_HINTS[key],
      cn: byKey.get(key)?.label_cn ?? null,
    }));
  }, [typeLabels]);

  const openings: LabelRow[] = useMemo(
    () =>
      openingLabels.filter((r) => !(r.draw in BLIND_CONTROL_TITLES)).map((r) => ({
        kind: "opening" as const,
        id: r.draw,
        title: r.draw,
        cn: r.label_cn,
      })),
    [openingLabels],
  );

  const blindControls: LabelRow[] = useMemo(
    () =>
      openingLabels.filter((r) => r.draw in BLIND_CONTROL_TITLES).map((r) => ({
        kind: "opening" as const,
        id: r.draw,
        title: BLIND_CONTROL_TITLES[r.draw],
        hint: "Printed in the PO Opening column for this blind control side.",
        cn: r.label_cn,
      })),
    [openingLabels],
  );

  const series: LabelRow[] = useMemo(
    () =>
      blindSeries.map((s) => ({
        kind: "series" as const,
        id: s.id,
        title: s.name,
        hint: s.is_active ? undefined : "Archived series.",
        cn: s.name_cn,
      })),
    [blindSeries],
  );

  const allRows = useMemo(
    () => [...rooms, ...types, ...openings, ...blindControls, ...series],
    [rooms, types, openings, blindControls, series],
  );

  // `saved` is what the server holds; `draft` is what the admin has typed. Kept
  // apart so the Save button can tell whether anything actually changed and
  // only the changed rows are written.
  const stored = useMemo(() => {
    const out: Draft = {};
    for (const row of allRows) {
      out[cnKey(row)] = row.cn ?? "";
      if (row.kind === "room") out[codeKey(row.id)] = row.code ?? "";
    }
    return out;
  }, [allRows]);

  const [saved, setSaved] = useState<Draft>(stored);
  const [draft, setDraft] = useState<Draft>(stored);

  function onChange(key: string, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  const changed = useMemo(
    () =>
      allRows.filter((row) => {
        const k = cnKey(row);
        const cnDiffers = (draft[k] ?? "").trim() !== (saved[k] ?? "").trim();
        if (row.kind !== "room") return cnDiffers;
        const ck = codeKey(row.id);
        return cnDiffers || (draft[ck] ?? "").trim() !== (saved[ck] ?? "").trim();
      }),
    [allRows, draft, saved],
  );

  // Counted off the DRAFT, so the tally answers "what is still missing" as the
  // admin types rather than as of the last page load.
  const missing = allRows.filter(
    (row) => (draft[cnKey(row)] ?? "").trim().length === 0,
  ).length;

  function saveAll() {
    if (changed.length === 0) return;
    startTransition(async () => {
      try {
        for (const row of changed) {
          const cn = (draft[cnKey(row)] ?? "").trim();
          if (row.kind === "room") {
            await saveRoomTypeLabel({
              roomType: row.id,
              nameCn: cn,
              code: draft[codeKey(row.id)] ?? "",
            });
          } else if (row.kind === "type") {
            await savePoTypeLabel({ key: row.id, labelCn: cn });
          } else if (row.kind === "opening") {
            await savePoOpeningLabel({ draw: row.id, labelCn: cn });
          } else {
            await saveSeriesNameCn({ seriesId: row.id, nameCn: cn });
          }
        }
        setSaved(draft);
        toast.success(
          changed.length === 1
            ? "Label saved"
            : `${changed.length} labels saved`,
        );
        router.refresh();
      } catch (e) {
        // The draft is deliberately left alone: whatever was typed stays on
        // screen so the admin can fix the one row the message names instead of
        // retyping the other nine.
        toast.error(e instanceof Error ? e.message : "Save failed");
      }
    });
  }

  return (
    <section className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <div className="px-4 py-4">
        <h2 className="text-base font-semibold text-slate-900">
          PO labels (中文)
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Every cell of a purchase order is a cutting instruction. A label we do
          not have <strong>blocks generation</strong> for any order that uses it
          — the document is never produced with a blank or English cell instead.
          These fields want <strong>Chinese</strong>; an entry with no Chinese
          characters is flagged, but still saved.
        </p>
        {missing > 0 ? (
          <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-100 rounded px-3 py-2">
            <strong>{missing}</strong>{" "}
            {missing === 1 ? "label is" : "labels are"} still missing. An order
            containing one of them cannot generate a purchase order until it is
            filled in.
          </p>
        ) : (
          <p className="mt-3 text-sm text-teal-700 bg-teal-50 border border-teal-100 rounded px-3 py-2">
            Every label has a value. Check anything flagged{" "}
            <span className="font-medium">No 中文</span> below.
          </p>
        )}
      </div>

      <LabelGroup
        title="Rooms — 房间"
        description="The table's first column: a Chinese name and a Latin code, e.g. 客厅 LR. A room type with no row blocks generation exactly as a blank name does. Note SR is taken by Service Yard, so Study Room needs a different code."
        rows={rooms}
        draft={draft}
        onChange={onChange}
      />
      <LabelGroup
        title="Types — 窗帘款式"
        description="What the covering is. 纱窗 Day and 窗帘 Night are read off the samples. A blind takes its wording from its series below and only falls back to the Blind row here."
        rows={types}
        draft={draft}
        onChange={onChange}
      />
      <LabelGroup
        title="Openings — 开法"
        description="The draw direction as the factory reads it. 对开 Double draw is on every curtain row of both curtain samples; the single draws are not evidenced anywhere."
        rows={openings}
        draft={draft}
        onChange={onChange}
      />
      <LabelGroup
        title="Blind pulley — 开法"
        description="A blind uses its saved control side. These labels print Pulley left or Pulley right in the PO Opening column without changing curtain draw wording."
        rows={blindControls}
        draft={draft}
        onChange={onChange}
      />
      <LabelGroup
        title="Blind series — 窗帘款式 per series"
        description="Blind wording is per series, not per product line: 卷帘 means a ROLLER blind specifically, and Roman, Venetian and Korean Combi are each a different word."
        rows={series}
        draft={draft}
        onChange={onChange}
      />

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 border-t border-slate-200 bg-slate-50">
        <p className="text-xs text-slate-500 max-w-xl">
          Do not guess. A plausible Chinese term on a factory instruction is the
          same class of error as a plausible dimension — left blank, the order is
          refused, which is the safe failure.
        </p>
        <div className="flex items-center gap-3 shrink-0">
          {changed.length > 0 && !pending && (
            <span className="text-xs text-amber-700">
              {changed.length} unsaved
            </span>
          )}
          <Button
            onClick={saveAll}
            disabled={pending || changed.length === 0}
            className="bg-teal-600 hover:bg-teal-700 text-white"
          >
            {pending ? "Saving…" : "Save labels"}
          </Button>
        </div>
      </div>
    </section>
  );
}
