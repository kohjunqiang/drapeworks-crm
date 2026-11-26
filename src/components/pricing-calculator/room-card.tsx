"use client";
import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resolveWindowAddons } from "@/lib/orders/window-addons";
import { changeCovering, measurement, type QuickQuoteData, type QuoteIssue } from "@/lib/pricing/quick-quote";
import { newCalculatorWindow, type CalculatorRoom, type CalculatorWindow } from "@/lib/validation/pricing-calculator";

export const FIELD = "mt-1 min-h-11 w-full min-w-0 rounded border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-100";
const COVERINGS = [{ value: "day", label: "Day" }, { value: "night", label: "Night" }, { value: "both", label: "Day & night" }, { value: "blind", label: "Blind" }] as const;

export function RoomCard({ room, data, issues, onChange, onRemove }: {
  room: CalculatorRoom; data: QuickQuoteData; issues: QuoteIssue[];
  onChange: (room: CalculatorRoom) => void; onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const coveringSummary = [...new Set(room.windows.map((window) => COVERINGS.find((item) => item.value === window.covering)?.label))].filter(Boolean).join(" + ");
  const update = (window: CalculatorWindow) => onChange({ ...room, windows: room.windows.map((w) => w.id === window.id ? window : w) });
  const addWindow = () => {
    const window = newCalculatorWindow(crypto.randomUUID(), /Toilet/.test(room.label) ? "blind" : "both");
    onChange({ ...room, windows: [...room.windows, window] });
    requestAnimationFrame(() => document.getElementById(`width-${window.id}`)?.focus());
  };
  return <section className="min-w-0 rounded-lg border border-slate-200 bg-white" aria-label={room.label}>
    <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
      <button type="button" className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left font-semibold" aria-expanded={expanded} aria-controls={`room-${room.id}`} onClick={() => setExpanded(!expanded)}>
        {expanded ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}<span className="min-w-0 break-words">{room.label}{!expanded && <span className="mt-0.5 block text-xs font-normal text-slate-500">{coveringSummary} · {room.windows.length} {room.windows.length === 1 ? "covering" : "coverings"}</span>}</span>
        {issues.length > 0 && <span className="ml-auto text-xs font-medium text-red-600">Incomplete</span>}
      </button>
      <Button type="button" variant="ghost" className="min-h-11 min-w-11" aria-label={`Remove ${room.label}`} onClick={onRemove}><Trash2 className="size-4" /></Button>
    </div>
    <div id={`room-${room.id}`} hidden={!expanded} className="space-y-4 p-4">
      <label className="block text-sm font-medium" htmlFor={`label-${room.id}`}>Room name<input id={`label-${room.id}`} className={FIELD} maxLength={100} value={room.label} onChange={(e) => onChange({ ...room, label: e.target.value })} /></label>
      {room.windows.map((window, index) => <WindowFields key={window.id} window={window} index={index} room={room} data={data} onChange={update} remove={() => {
        if (globalThis.confirm(`Remove Window ${index + 1} from ${room.label}?`)) onChange({ ...room, windows: room.windows.filter((w) => w.id !== window.id) });
      }} />)}
      {issues.length > 0 && <ul className="space-y-1 text-sm text-red-600" aria-label={`${room.label} needs attention`}>{issues.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul>}
      <Button type="button" variant="outline" className="min-h-11 w-full border-teal-600 text-teal-700" onClick={addWindow}><Plus className="size-4" />Add another covering</Button>
    </div>
  </section>;
}
function WindowFields({ window, index, room, data, onChange, remove }: {
  window: CalculatorWindow; index: number; room: CalculatorRoom; data: QuickQuoteData;
  onChange: (window: CalculatorWindow) => void; remove: () => void;
}) {
  const patch = (change: Partial<CalculatorWindow>) => onChange({ ...window, ...change });
  const isBlind = window.covering === "blind";
  const hasDay = window.covering === "day" || window.covering === "both";
  const hasNight = window.covering === "night" || window.covering === "both";
  const addons = resolveWindowAddons(isBlind ? "blind" : "curtain", measurement(window.width), window.addonIds, [], data.config.addonCatalogue);
  const options = (kind: "day" | "night" | "blind") => data.options.filter((p) => kind === "blind" ? p.productLine === "blind" : p.productLine === "curtain" && p.category === (kind === "day" ? "Day" : "Night"));
  const fabric = (kind: "day" | "night" | "blind", value: string, key: "dayId" | "nightId" | "blindId") => <label className="block min-w-0 text-sm font-medium" htmlFor={`${kind}-${window.id}`}>
    {kind === "blind" ? "Blind type" : kind === "day" ? "Day fabric" : "Night fabric"}
    <select id={`${kind}-${window.id}`} className={FIELD} value={value} onChange={(e) => patch({ [key]: e.target.value })}><option value="">Select {kind === "blind" ? "blind" : "fabric tier"}</option>{options(kind).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
    {options(kind).length === 0 && <span className="mt-1 block text-xs text-red-600">No priced {kind} options are available.</span>}
  </label>;
  return <fieldset className="min-w-0 space-y-3 rounded border border-slate-200 p-3">
    <legend className="px-1 text-sm font-semibold">Window {index + 1}</legend>
    <div className="flex items-center justify-between gap-2"><span className="text-xs text-slate-500">Covering</span>{room.windows.length > 1 && <Button type="button" variant="ghost" className="min-h-11" aria-label={`Remove Window ${index + 1} from ${room.label}`} onClick={remove}><Trash2 className="size-4" /></Button>}</div>
    <div role="group" aria-label={`Window ${index + 1} covering`} className="grid grid-cols-4 rounded border border-slate-300 p-0.5">{COVERINGS.map((item) => <button key={item.value} type="button" aria-pressed={window.covering === item.value} onClick={() => onChange(changeCovering(window, item.value))} className={`min-h-11 rounded px-1 text-xs font-medium ${window.covering === item.value ? "bg-teal-600 text-white" : "text-slate-700 hover:bg-slate-100"}`}>{item.label}</button>)}</div>
    <div className="grid grid-cols-2 gap-3">
      <label className="block text-sm font-medium" htmlFor={`width-${window.id}`}>Width (cm)<input id={`width-${window.id}`} inputMode="numeric" className={FIELD} value={window.width} onChange={(e) => patch({ width: e.target.value })} /></label>
      <label className="block text-sm font-medium" htmlFor={`height-${window.id}`}>Height (cm)<input id={`height-${window.id}`} inputMode="numeric" className={FIELD} value={window.height} onChange={(e) => patch({ height: e.target.value })} /><span className="mt-1 block text-xs font-normal text-slate-500">Optional for pricing</span></label>
    </div>
    <div className={`grid gap-3 ${hasDay && hasNight ? "sm:grid-cols-2" : ""}`}>{hasDay && fabric("day", window.dayId, "dayId")}{hasNight && fabric("night", window.nightId, "nightId")}{isBlind && fabric("blind", window.blindId, "blindId")}</div>
    {addons.length > 0 && <div><p className="text-sm font-medium">Upgrades</p><div className="flex flex-wrap gap-x-4">{addons.map((addon) => <label key={addon.id} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-teal-600" checked={addon.selected} disabled={addon.locked} onChange={(e) => patch({ addonIds: e.target.checked ? [...window.addonIds, addon.id] : window.addonIds.filter((id) => id !== addon.id) })} />{addon.label}{addon.locked && <span className="text-xs text-slate-500">(automatic)</span>}</label>)}</div></div>}
    <details className="border-t border-slate-100 pt-1"><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Track &amp; installation options</summary><div className="space-y-2">
      {hasDay && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-teal-600" checked={window.dayTrack} onChange={(e) => patch({ dayTrack: e.target.checked })} />New day track required</label>}
      {hasNight && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-teal-600" checked={window.nightTrack} onChange={(e) => patch({ nightTrack: e.target.checked })} />New night track required</label>}
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-teal-600" checked={window.noInstallation} onChange={(e) => patch({ noInstallation: e.target.checked })} />No installation needed</label>
      {!isBlind && data.combos.length > 0 && <label className="block text-sm font-medium">Combo<select className={FIELD} value={window.comboId} onChange={(e) => patch({ comboId: e.target.value })}><option value="">No combo</option>{data.combos.map((combo) => <option key={combo.id} value={combo.id}>{combo.name}</option>)}</select></label>}
    </div></details>
  </fieldset>;
}
