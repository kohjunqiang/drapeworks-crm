"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { AppSelect } from "@/components/ui/app-select";
import { formatSGD } from "@/lib/money";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { resolveWindowAddons } from "@/lib/orders/window-addons";
import { changeCovering, editWorksheetWindow, measurement, newQuickQuoteWindow, type QuickQuoteData, type quickQuote, type QuoteIssue } from "@/lib/pricing/quick-quote";
import { type CalculatorRoom, type CalculatorWindow } from "@/lib/validation/pricing-calculator";

export const FIELD = "mt-1 min-h-11 w-full min-w-0 rounded border border-slate-200 bg-white px-2.5 py-2 text-base sm:text-sm focus:outline-none focus:border-teal-500";
export const SELECT_FIELD = "mt-1 min-h-11 w-full min-w-0";
const COVERINGS = [{ value: "day", label: "Day" }, { value: "night", label: "Night" }, { value: "both", label: "Day & night" }, { value: "blind", label: "Blind" }] as const;

export function RoomCard({ room, data, issues, items, onChange, onRemove }: {
  room: CalculatorRoom; data: QuickQuoteData; issues: QuoteIssue[]; items: ReturnType<typeof quickQuote>["items"];
  onChange: (room: CalculatorRoom) => void; onRemove: () => void;
}) {
  const update = (window: CalculatorWindow) => onChange({ ...room, windows: room.windows.map((w) => w.id === window.id ? { ...window, active: true } : w) });
  const addWindow = () => {
    const window = { ...newQuickQuoteWindow(crypto.randomUUID(), data.options, (room.preset ? ["preset-5", "preset-6"].includes(room.id) : room.label.includes("Toilet")) ? "blind" : "both"), active: true };
    onChange({ ...room, windows: [...room.windows, window] });
    requestAnimationFrame(() => document.getElementById(`width-${window.id}`)?.focus());
  };
  return <>{room.windows.map((window, index) => <WindowFields key={window.id} window={window} index={index} room={room} data={data} onChange={update} addWindow={addWindow} item={items.find((item) => item.windowId === window.id)} issues={issues.filter((issue) => issue.windowId === window.id)} onRename={(label) => onChange({ ...room, label })} remove={() => {
    if (index === 0) onRemove();
    else {
      onChange({ ...room, windows: room.windows.filter((w) => w.id !== window.id) });
      requestAnimationFrame(() => document.getElementById(`width-${room.windows[index - 1].id}`)?.focus());
    }
  }} />)}</>;
}
function WindowFields({ window, index, room, data, onChange, remove, addWindow, item, issues, onRename }: {
  window: CalculatorWindow; index: number; room: CalculatorRoom; data: QuickQuoteData;
  onChange: (window: CalculatorWindow) => void; remove: () => void; addWindow: () => void;
  onRename: (label: string) => void;
  item?: ReturnType<typeof quickQuote>["items"][number]; issues: QuoteIssue[];
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [upgradesOpen, setUpgradesOpen] = useState(false);
  const accessibleName = `${room.label} covering ${index + 1}`;
  const patch = (change: Partial<CalculatorWindow>) => onChange(editWorksheetWindow(window, change));
  const isBlind = window.covering === "blind";
  const hasDay = window.covering === "day" || window.covering === "both";
  const hasNight = window.covering === "night" || window.covering === "both";
  const addons = resolveWindowAddons(isBlind ? "blind" : "curtain", measurement(window.width), window.addonIds, [], data.config.addonCatalogue);
  const options = (kind: "day" | "night" | "blind") => data.options.filter((p) => kind === "blind" ? p.productLine === "blind" : p.productLine === "curtain" && p.category === (kind === "day" ? "Day" : "Night"));
  const fabric = (kind: "day" | "night" | "blind", value: string, key: "dayId" | "nightId" | "blindId") => <div className="min-w-0">
    <label className="sr-only" htmlFor={`${kind}-${window.id}`}>{accessibleName} {kind === "blind" ? "blind type" : kind === "day" ? "day fabric" : "night fabric"}</label>
    <span className="block text-[10px] leading-3 text-slate-500" aria-hidden="true">{kind === "day" ? "Day" : kind === "night" ? "Night" : "Blind"}</span>
    <AppSelect id={`${kind}-${window.id}`} triggerClassName={SELECT_FIELD} value={value} onChange={(selected) => patch({ [key]: selected })} noneLabel={`Select ${kind === "blind" ? "blind" : "fabric tier"}`} options={options(kind).map((p) => ({ value: p.id, label: p.name }))} />
    {options(kind).length === 0 && <span className="mt-1 block text-xs text-red-600">No priced {kind} options are available.</span>}
  </div>;
  const feedback = issues.find((issue) => issue.severity === "error") ?? issues[0];
  const cell = "border-b border-slate-200 px-2 py-2 align-top";
  return <tr aria-label={`${room.label} covering ${index + 1}`}>
    <th scope="row" className={`${cell} sticky left-0 z-10 border-r bg-white text-left text-sm font-medium`}>
      <span className="block break-words">{index === 0 ? room.label : `↳ Covering ${index + 1}`}</span>
      <span className={`mt-1 block text-xs font-normal ${feedback?.severity === "error" ? "text-red-600" : "text-slate-500"}`}>{window.active === false ? "Not included" : feedback ? "Needs input" : "Included"}</span>
    </th>
    <td className={cell}><label className="sr-only" htmlFor={`width-${window.id}`}>{room.label} covering {index + 1} width (cm)</label><input id={`width-${window.id}`} inputMode="numeric" placeholder="Width" className={`${FIELD} scroll-ml-[118px]`} onKeyDown={(event) => {
      if (event.key !== "Enter" && event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const inputs = Array.from(event.currentTarget.closest("table")?.querySelectorAll<HTMLInputElement>('input[id^="width-"]') ?? []);
      const next = inputs[inputs.indexOf(event.currentTarget) + (event.key === "ArrowUp" ? -1 : 1)];
      if (next) { next.focus({ preventScroll: true }); next.scrollIntoView({ block: "nearest", inline: "nearest" }); }
    }} value={window.width} onChange={(e) => patch({ width: e.target.value })} aria-invalid={issues.some((issue) => issue.kind === "invalid_measurement")} />{feedback && <p className={`mt-1 text-xs ${feedback.severity === "error" ? "text-red-600" : "text-slate-500"}`}>{feedback.message.split(": ").slice(1).join(": ")}</p>}</td>
    <td className={cell}><label className="sr-only" htmlFor={`covering-${window.id}`}>{room.label} covering {index + 1} type</label><AppSelect id={`covering-${window.id}`} triggerClassName={SELECT_FIELD} value={window.covering} onChange={(value) => onChange(changeCovering(window, value as CalculatorWindow["covering"], data.options))} options={[...COVERINGS]} /></td>
    <td className={cell}><div className="grid grid-cols-2 gap-2">{hasDay && fabric("day", window.dayId, "dayId")}{hasNight && fabric("night", window.nightId, "nightId")}{isBlind && fabric("blind", window.blindId, "blindId")}</div></td>
    <td className={cell}>
    {addons.length > 0 ? <Dialog open={upgradesOpen} onOpenChange={setUpgradesOpen}><DialogTrigger render={<Button variant="outline" className="mt-1 min-h-11" aria-label={`${accessibleName} upgrades`} />}>Upgrades · {addons.filter((addon) => addon.selected).length}</DialogTrigger><DialogContent><DialogTitle>{accessibleName} upgrades</DialogTitle><DialogDescription>Select upgrades for this covering.</DialogDescription><div>{addons.map((addon) => <label key={addon.id} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-teal-600" checked={addon.selected} disabled={addon.locked} onChange={(e) => patch({ addonIds: e.target.checked ? [...window.addonIds, addon.id] : window.addonIds.filter((id) => id !== addon.id) })} />{addon.label}{addon.locked && <span className="text-xs text-slate-500">(automatic)</span>}</label>)}</div><DialogClose render={<Button variant="outline" className="min-h-11" />}>Back to worksheet</DialogClose></DialogContent></Dialog> : <span className="block py-3 text-sm text-slate-500">—</span>}
    </td>
    <td className={`${cell} text-sm font-medium`}><span className="block py-3">{!item || item.subtotalCents === null ? "—" : item.includedInPackage ? "Included in package" : formatSGD(item.subtotalCents)}</span></td>
    <td className={cell}><div className="flex gap-1"><Dialog open={detailsOpen} onOpenChange={setDetailsOpen}><DialogTrigger render={<Button variant="outline" className="min-h-11" aria-label={`${accessibleName} details`} />}>Details</DialogTrigger><DialogContent className="sm:max-w-lg"><DialogTitle>{room.label} · Covering {index + 1}</DialogTitle><DialogDescription>Optional height, tracks and installation. Editing includes this covering in the quote.</DialogDescription>
    <label className="block text-sm font-medium" htmlFor={`room-name-${window.id}`}>Room name<input id={`room-name-${window.id}`} className={FIELD} maxLength={100} value={room.label} onChange={(event) => onRename(event.target.value)} /></label>
    <label className="block text-sm font-medium" htmlFor={`height-${window.id}`}>Height (cm)<input id={`height-${window.id}`} inputMode="numeric" className={FIELD} value={window.height} onChange={(e) => patch({ height: e.target.value })} /><span className="text-xs font-normal text-slate-500">Optional for pricing</span></label>
    <div className="space-y-2">

      {hasDay && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-teal-600" checked={window.dayTrack} onChange={(e) => patch({ dayTrack: e.target.checked })} />New day track required</label>}
      {hasNight && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-teal-600" checked={window.nightTrack} onChange={(e) => patch({ nightTrack: e.target.checked })} />New night track required</label>}
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-teal-600" checked={window.noInstallation} onChange={(e) => patch({ noInstallation: e.target.checked })} />No installation needed</label>
      {!isBlind && data.combos.length > 0 && <div><label htmlFor={`combo-${window.id}`} className="block text-sm font-medium">Combo</label><AppSelect id={`combo-${window.id}`} triggerClassName={SELECT_FIELD} value={window.comboId} onChange={(comboId) => patch({ comboId })} noneLabel="No combo" options={data.combos.map((combo) => ({ value: combo.id, label: combo.name }))} /></div>}
    </div><DialogClose render={<Button variant="outline" className="min-h-11" />}>Back to worksheet</DialogClose></DialogContent></Dialog>
    {index === 0 && <Button type="button" variant="ghost" className="min-h-11 min-w-11" aria-label={`Add another covering to ${room.label}`} onClick={addWindow}><Plus className="size-4" /></Button>}
    <Button type="button" variant="ghost" className="min-h-11 min-w-11" aria-label={index === 0 ? `${room.preset ? "Clear" : "Remove"} ${room.label}` : `Remove covering ${index + 1} from ${room.label}`} onClick={remove}><Trash2 className="size-4" /></Button></div></td>
  </tr>;
}
