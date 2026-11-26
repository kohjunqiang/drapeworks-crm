"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useForm, useWatch, type UseFormSetValue } from "react-hook-form";
import { AppSelect, FormSelect } from "@/components/ui/app-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { QuickAddRoomBar, type RoomTemplate } from "@/components/orders/consultation-form/quick-add-room-bar";
import { newQuickQuoteWindow, quickQuote, type QuickQuoteData } from "@/lib/pricing/quick-quote";
import { clearQuickQuoteDraft, readQuickQuoteDraft, writeQuickQuoteDraft } from "@/lib/pricing/quick-quote-draft";
import { calculatorDefaults, type CalculatorValues } from "@/lib/validation/pricing-calculator";
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
  const form = useForm<CalculatorValues>({ defaultValues: initialDraft?.values ?? calculatorDefaults });
  const values = useWatch({ control: form.control }) as CalculatorValues;
  const [override, setOverride] = useState<string | null>(initialDraft?.override ?? null);
  const [restoredDirty, setRestoredDirty] = useState(initialDraft !== null);
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
  const addRoom = (template: RoomTemplate) => {
    const count = values.rooms.filter((room) => room.label === template.label || room.label.startsWith(`${template.label} `)).length;
    const room = { id: crypto.randomUUID(), label: `${template.label}${count ? ` ${count + 1}` : ""}`, windows: [newQuickQuoteWindow(crypto.randomUUID(), data.options, /Toilet/.test(template.type) ? "blind" : "both")] };
    set("rooms", [...values.rooms, room]);
    requestAnimationFrame(() => document.getElementById(`label-${room.id}`)?.focus());
  };
  const removeRoom = (roomId: string) => {
    const removedIndex = values.rooms.findIndex((room) => room.id === roomId);
    const remaining = values.rooms.filter((room) => room.id !== roomId);
    set("rooms", remaining);
    requestAnimationFrame(() => {
      const next = remaining[Math.min(removedIndex, remaining.length - 1)];
      if (next) document.getElementById(`room-toggle-${next.id}`)?.focus();
      else document.querySelector<HTMLButtonElement>('[aria-label="Quick add rooms"] button')?.focus();
    });
  };
  const summaryProps = { result, values, data, override, onOverride: setOverride, onDiscount: (value: string) => set("discount", value) };
  return <main className="mx-auto max-w-7xl p-4 pb-60 sm:p-6 sm:pb-60 lg:pb-6">
    <div className="mb-5 flex items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold text-slate-900">Pricing Calculator</h1><p className="mt-1 text-sm text-slate-500">Quick whole-home quote</p></div><Button type="button" variant="outline" className="min-h-11" onClick={() => { if (!dirty || confirm("Reset this calculator and clear all rooms and price adjustments?")) { clearQuickQuoteDraft(profileId); form.reset(calculatorDefaults); setOverride(null); setRestoredDirty(false); } }}>Reset</Button></div>
    {data.packages.length > 0 && <section className="mb-4 rounded-lg border border-slate-200 bg-white p-4" aria-label="Pricing basis"><div className="grid gap-4 sm:grid-cols-2">
      <div><label htmlFor="calculator-pricing-basis" className="block text-sm font-medium">Pricing basis</label><AppSelect id="calculator-pricing-basis" triggerClassName={SELECT_FIELD} value={values.packageId} onChange={(packageId) => { set("packageId", packageId); set("packageTier", "essential"); }} noneLabel="Item pricing" options={data.packages.map((item) => ({ value: item.id, label: item.name }))} /></div>
      {selectedPackage && <div><label htmlFor="calculator-package-tier" className="block text-sm font-medium">Package tier</label><FormSelect id="calculator-package-tier" triggerClassName={SELECT_FIELD} control={form.control} name="packageTier" options={[{ value: "essential", label: "Essential" }, ...(selectedPackage.tier2UpgradeSgd !== "" ? [{ value: "tier2", label: "Tier 2 (Performance / Luxe / Signature)" }] : [])]} /></div>}
      {selectedPackage?.packageType === "single" && <div><label htmlFor="calculator-single-layer" className="block text-sm font-medium">Included single layer</label><FormSelect id="calculator-single-layer" triggerClassName={SELECT_FIELD} control={form.control} name="singleLayer" options={[{ value: "night", label: "Night curtain" }, { value: "day", label: "Day curtain" }]} /></div>}
    </div>{selectedPackage && <p className="mt-2 text-xs text-slate-500">{selectedPackage.roomSetCount} room sets · {selectedPackage.packageType} curtain package. Room selections determine upgrades and credits.</p>}</section>}
    <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="min-w-0 space-y-4"><QuickAddRoomBar onAdd={addRoom} compactSticky />
        {values.rooms.length === 0 && <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center"><h2 className="font-semibold">Start with a room</h2><p className="mt-2 text-sm text-slate-500">Add a room above, then choose its coverings and widths. No customer or order details are needed.</p></div>}
        {values.rooms.map((room) => <RoomCard key={room.id} room={room} data={data} issues={result.issues.filter((issue) => issue.roomId === room.id)} onChange={(updated) => set("rooms", values.rooms.map((r) => r.id === room.id ? updated : r))} onRemove={() => removeRoom(room.id)} />)}
        <details className="rounded-lg border border-slate-200 bg-white p-4"><summary className="min-h-11 cursor-pointer py-2 font-semibold">Pricing options<span className="mt-1 block text-xs font-normal text-slate-500">Freight, sales channel and installation</span></summary><div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div><label htmlFor="calculator-freight" className="block text-sm font-medium">Freight</label><FormSelect id="calculator-freight" triggerClassName={SELECT_FIELD} control={form.control} name="freight" options={[{ value: "air", label: "Air" }, { value: "sea", label: "Sea" }]} /></div>
          <div><label htmlFor="calculator-channel" className="block text-sm font-medium">Sales channel</label><FormSelect id="calculator-channel" triggerClassName={SELECT_FIELD} control={form.control} name="channel" options={[{ value: "standard", label: "Standard" }, { value: "carousell", label: "Carousell" }]} /></div>
          <label className="block text-sm font-medium sm:col-span-2">Additional installation / transport (SGD)<input className={FIELD} inputMode="decimal" {...form.register("extraInstallation")} /></label>
        </div></details>
        <p className="text-xs text-slate-500">This calculator does not save a quote or create an order.</p>
      </div>
      <aside className="sticky top-4 hidden min-w-0 rounded-lg border border-slate-200 bg-white p-4 lg:block"><QuoteSummary {...summaryProps} id="desktop" /></aside>
    </div>
    <Dialog open={mobileOpen} onOpenChange={setMobileOpen}><div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-lg lg:hidden"><FinalPrice {...summaryProps} id="mobile-bar" compact /><DialogTrigger render={<Button className="mt-2 min-h-11 w-full bg-teal-600 text-white hover:bg-teal-700" />}>View pricing &amp; adjust</DialogTrigger></div>
      <DialogContent className="max-w-[calc(100%-1rem)] sm:max-w-lg"><DialogTitle>Pricing &amp; margin</DialogTitle><DialogDescription>Review your whole-home quote and adjust the final selling price.</DialogDescription><QuoteSummary {...summaryProps} id="mobile-dialog" /><DialogClose render={<Button variant="outline" className="min-h-11 w-full" />}>Back to rooms</DialogClose></DialogContent>
    </Dialog>
  </main>;
}
