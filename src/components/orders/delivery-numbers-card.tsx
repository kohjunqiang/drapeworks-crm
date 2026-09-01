"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveDeliveryNumbers } from "@/lib/actions/logistics";

type Values = { goodsOverseas: string; goodsLocal: string; trackOverseas: string; trackLocal: string };
export function DeliveryNumbersCard({ orderId, initial, canEdit }: { orderId: string; initial: Values; canEdit: boolean }) {
  const [values, setValues] = useState(initial);
  const [pending, startTransition] = useTransition();
  const field = (key: keyof Values, label: string) => <label className="space-y-1 text-xs font-medium text-slate-600">
    {label}<Input value={values[key]} disabled={!canEdit || pending} maxLength={200}
      onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))} />
  </label>;
  return <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
    <div><h2 className="font-semibold text-slate-900">Delivery numbers</h2>
      <p className="text-xs text-slate-500">Curtains and blinds travel together. Track delivery is recorded separately.</p></div>
    <div className="grid gap-4 md:grid-cols-2">
      <fieldset className="space-y-3 rounded border border-slate-100 p-3"><legend className="px-1 text-sm font-medium">Curtains &amp; blinds</legend>
        {field("goodsLocal", "Local delivery number · Sent to Logistic Partner")}{field("goodsOverseas", "Overseas freight number · Shipping to SG")}</fieldset>
      <fieldset className="space-y-3 rounded border border-slate-100 p-3"><legend className="px-1 text-sm font-medium">Track shipment</legend>
        {field("trackLocal", "Local delivery number · Sent to Logistic Partner")}{field("trackOverseas", "Overseas freight number · Shipping to SG")}</fieldset>
    </div>
    {canEdit && <Button disabled={pending} onClick={() => startTransition(async () => {
      try { await saveDeliveryNumbers({ orderId, ...values }); toast.success("Delivery numbers saved"); }
      catch (error) { toast.error(error instanceof Error ? error.message : "Could not save delivery numbers"); }
    })}>{pending ? "Saving…" : "Save delivery numbers"}</Button>}
  </section>;
}
