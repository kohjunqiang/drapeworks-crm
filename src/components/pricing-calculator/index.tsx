"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useForm, useWatch, type UseFormSetValue } from "react-hook-form";
import { AppSelect, FormSelect } from "@/components/ui/app-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { clearWorksheetRoom, newQuickQuoteWindow, newWorksheet, quickQuote, type QuickQuoteData } from "@/lib/pricing/quick-quote";
import { clearQuickQuoteDraft, readQuickQuoteDraft, writeQuickQuoteDraft } from "@/lib/pricing/quick-quote-draft";
import { type CalculatorValues } from "@/lib/validation/pricing-calculator";
import { FIELD, SELECT_FIELD, RoomCard } from "./room-card";
import { FinalPrice, QuoteSummary } from "./summary";

const subscribeHydration = () => () => {};
const browserReady = () => true;
const serverReady = () => false;
type CalculatorProps = { data: QuickQuoteData; profileId: string };

export function PricingCalculator(props: CalculatorProps) {
  // Start the form only after hydration. The server never reads tab memory,
  // and the first browser render matches the server's loading view exactly.
  const hydrated = useSyncExternalStore(subscribeHydration, browserReady, serverReady);
  if (!hydrated) return <main className="mx-auto max-w-7xl p-4 sm:p-6" role="status"><h1 className="text-2xl font-semibold">Pricing Calculator</h1><p className="mt-4 text-slate-500">Preparing your calculator…</p></main>;
  return <PricingCalculatorForm {...props} />;
}

function PricingCalculatorForm({ data, profileId }: CalculatorProps) {
  const [initialDraft] = useState(() => readQuickQuoteDraft(profileId));
  const form = useForm<CalculatorValues>({ defaultValues: initialDraft?.values ?? newWorksheet(data.options) });
  const values = useWatch({ control: form.control }) as CalculatorValues;
  const [override, setOverride] = useState<string | null>(initialDraft?.override ?? null);
  const [restoredDirty, setRestoredDirty] = useState(initialDraft !== null);
  const [moreRooms, setMoreRooms] = useState(false);
  const worksheetRef = useRef<HTMLDivElement>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const result = quickQuote(values, data);
  const dirty = restoredDirty || form.formState.isDirty || override !== null;
  useEffect(() => {
    if (dirty) writeQuickQuoteDraft(profileId, { values, override });
    else clearQuickQuoteDraft(profileId);
  }, [dirty, profileId, values, override]);
  const dirtyRef = useRef(dirty);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ""; } };
    const navigate = (event: MouseEvent) => {
      if (!dirtyRef.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element).closest("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.hasAttribute("download") || link.href === location.href || link.getAttribute("href")?.startsWith("#")) return;
      if (!confirm("Leave the calculator? Your quote is not saved.")) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", navigate, true); };
  }, []);
  const set: UseFormSetValue<CalculatorValues> = (key, value) => form.setValue(key, value, { shouldDirty: true });
  const selectedPackage = data.packages.find((item) => item.id === values.packageId);
  const addRoom = () => {
    const room = { id: crypto.randomUUID(), label: `Custom room ${values.rooms.filter((room) => !room.preset).length + 1}`, windows: [{ ...newQuickQuoteWindow(crypto.randomUUID(), data.options), active: true }] };
    set("rooms", [...values.rooms, room]);
    requestAnimationFrame(() => document.getElementById(`width-${room.windows[0].id}`)?.focus());
  };
  const removeRoom = (roomId: string) => {
    const room = values.rooms.find((room) => room.id === roomId)!;
    const remaining = room.preset ? values.rooms.map((r) => r.id === roomId ? clearWorksheetRoom(r, data.options) : r) : values.rooms.filter((r) => r.id !== roomId);
    set("rooms", remaining);
    requestAnimationFrame(() => document.getElementById(`width-${(remaining.find((r) => r.id === roomId) ?? remaining[0])?.windows[0]?.id}`)?.focus());
  };
  const visibleRooms = values.rooms.filter((room, index) => index < 5 || !room.preset || moreRooms || room.windows.some((window) => window.active !== false));
  const summaryProps = { result, values, data, override, onOverride: setOverride, onDiscount: (value: string) => set("discount", value) };
  return <main className="mx-auto max-w-[1600px] min-w-0 p-3 pb-60 sm:p-3 sm:pb-32">
    <div className="mb-1 flex min-h-11 items-center justify-between gap-4"><div><h1 className="text-2xl font-semibold text-slate-900">Pricing Calculator</h1></div><Button type="button" variant="outline" className="min-h-11" onClick={() => { if (!dirty || confirm("Reset this calculator and clear all rooms and price adjustments?")) { clearQuickQuoteDraft(profileId); form.reset(newWorksheet(data.options)); setOverride(null); setRestoredDirty(false); } }}>Reset</Button></div>
    {data.packages.length > 0 && <section className="mb-1" aria-label="Pricing basis"><div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-2"><label htmlFor="calculator-pricing-basis" className="shrink-0 text-xs font-medium">Pricing basis</label><AppSelect id="calculator-pricing-basis" triggerClassName="min-h-11 w-[210px]" value={values.packageId} onChange={(packageId) => { set("packageId", packageId); set("packageTier", "essential"); }} noneLabel="Item pricing" options={data.packages.map((item) => ({ value: item.id, label: item.name }))} /></div>
      {selectedPackage && <div className="flex items-center gap-2"><label htmlFor="calculator-package-tier" className="text-xs font-medium">Package tier</label><FormSelect id="calculator-package-tier" triggerClassName="min-h-11 w-[180px]" control={form.control} name="packageTier" options={[{ value: "essential", label: "Essential" }, ...(selectedPackage.tier2UpgradeSgd !== "" ? [{ value: "tier2", label: "Tier 2 (Performance / Luxe / Signature)" }] : [])]} /></div>}
      {selectedPackage?.packageType === "single" && <div className="flex items-center gap-2"><label htmlFor="calculator-single-layer" className="text-xs font-medium">Included single layer</label><FormSelect id="calculator-single-layer" triggerClassName="min-h-11 w-[160px]" control={form.control} name="singleLayer" options={[{ value: "night", label: "Night curtain" }, { value: "day", label: "Day curtain" }]} /></div>}
    </div></section>}
    <section aria-label="Room worksheet" className="min-w-0">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-1 text-xs text-slate-500"><p id="worksheet-scroll-help" className="min-w-[160px] flex-1">Enter width to include a room.<span className="block sm:inline"> Scroll across for more →</span></p><div className="flex gap-1"><Button id="add-custom-room" type="button" variant="outline" className="min-h-11" onClick={addRoom}>Add custom room</Button><Button type="button" variant="outline" className="min-h-11 min-w-11" aria-label="Scroll worksheet left" onClick={() => worksheetRef.current?.scrollBy({ left: -280, behavior: "smooth" })}>←</Button><Button type="button" variant="outline" className="min-h-11 min-w-11" aria-label="Scroll worksheet right" onClick={() => worksheetRef.current?.scrollBy({ left: 280, behavior: "smooth" })}>→</Button></div></div>
      <div ref={worksheetRef} tabIndex={0} role="region" aria-label="Room pricing worksheet" aria-describedby="worksheet-scroll-help" className="w-full min-w-0 overflow-x-auto rounded-lg border border-slate-200 bg-white focus-visible:outline-2 focus-visible:outline-teal-600">
        <table className="w-full min-w-[1210px] table-fixed text-left"><colgroup><col className="w-[110px]" /><col className="w-[140px]" /><col className="w-[150px]" /><col className="w-[310px]" /><col className="w-[180px]" /><col className="w-[140px]" /><col className="w-[180px]" /></colgroup><thead><tr className="bg-slate-50 text-xs text-slate-600">{["Room", "Width (cm)", "Covering", "Fabrics / blind type", "Upgrades", "Item subtotal", "Details / actions"].map((label, index) => <th key={label} scope="col" className={`px-2 py-3 ${index === 0 ? "sticky left-0 z-20 border-r border-slate-200 bg-slate-50" : ""}`}>{label}</th>)}</tr></thead><tbody>
        {visibleRooms.map((room) => <RoomCard key={room.id} room={room} data={data} items={result.items} issues={result.issues.filter((issue) => issue.roomId === room.id)} onChange={(updated) => set("rooms", values.rooms.map((r) => r.id === room.id ? updated : r))} onRemove={() => removeRoom(room.id)} />)}
        </tbody></table>
      </div>
      <div className="my-3 flex flex-wrap items-center justify-between gap-2"><Button type="button" variant="ghost" className="min-h-11 text-teal-700" aria-expanded={moreRooms} onClick={() => setMoreRooms(!moreRooms)}>{moreRooms ? "Fewer rooms" : "More rooms · toilets, kitchen, study, balcony, service yard"}</Button><p className="text-xs text-slate-500">{result.roomCount} rooms · {result.coveringCount} coverings included</p></div>
      <p className="mb-4 text-xs text-slate-500">Item subtotals include merchandise and upgrades. Packages, minimum order, discounts and other whole-home adjustments appear in pricing.</p>
        <details className="rounded-lg border border-slate-200 bg-white p-4"><summary className="min-h-11 cursor-pointer py-2 font-semibold">Pricing options<span className="mt-1 block text-xs font-normal text-slate-500">Freight, sales channel and installation</span></summary><div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div><label htmlFor="calculator-freight" className="block text-sm font-medium">Freight</label><FormSelect id="calculator-freight" triggerClassName={SELECT_FIELD} control={form.control} name="freight" options={[{ value: "air", label: "Air" }, { value: "sea", label: "Sea" }]} /></div>
          <div><label htmlFor="calculator-channel" className="block text-sm font-medium">Sales channel</label><FormSelect id="calculator-channel" triggerClassName={SELECT_FIELD} control={form.control} name="channel" options={[{ value: "standard", label: "Standard" }, { value: "carousell", label: "Carousell" }]} /></div>
          <label className="block text-sm font-medium sm:col-span-2">Additional installation / transport (SGD)<input className={FIELD} inputMode="decimal" {...form.register("extraInstallation")} /></label>
        </div></details>
        <p className="text-xs text-slate-500">This calculator does not save a quote or create an order.</p>
    </section>
    <Dialog open={mobileOpen} onOpenChange={setMobileOpen}><div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-lg"><div className="mx-auto max-w-6xl lg:flex lg:items-center lg:gap-3"><div className="min-w-0 flex-1"><FinalPrice {...summaryProps} id="mobile-bar" compact /></div><DialogTrigger render={<Button className="mt-2 min-h-11 w-full lg:mt-0 lg:w-auto bg-teal-600 text-white hover:bg-teal-700" />}>View pricing &amp; adjust</DialogTrigger></div></div>
      <DialogContent className="max-w-[calc(100%-1rem)] sm:max-w-lg"><DialogTitle>Pricing &amp; margin</DialogTitle><DialogDescription>Review your whole-home quote and adjust the final selling price.</DialogDescription><QuoteSummary {...summaryProps} id="mobile-dialog" /><DialogClose render={<Button variant="outline" className="min-h-11 w-full" />}>Back to rooms</DialogClose></DialogContent>
    </Dialog>
  </main>;
}
