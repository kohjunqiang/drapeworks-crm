"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getMarkAsWonContext,
  markLeadAsWon,
  searchWonLinkOrders,
} from "@/lib/actions/leads";
import { statusIndex, STATUS_LABELS } from "@/lib/status-flow";
import { markAsWonSchema, wonOrderSearchSchema } from "@/lib/validation/lead";

const LABEL = "text-xs font-medium uppercase tracking-wide text-slate-500";

type Context = Extract<Awaited<ReturnType<typeof getMarkAsWonContext>>, { ok: true }>;
type Candidate = Awaited<ReturnType<typeof searchWonLinkOrders>>[number];
type OrderLike = Candidate | NonNullable<Context["linkedOrder"]>;
type WonInput = z.input<typeof markAsWonSchema>;

// The server re-checks everything; this is only so the dialog can explain
// the next step instead of offering a dead-end confirm button.
function blocker(order: OrderLike, leadId: string, leadCustomerId: string | null): string | null {
  if (order.is_draft) {
    return "This order is still a draft consultation. Finish the consultation and record the deposit before marking the lead Won.";
  }
  if (order.lead_id && order.lead_id !== leadId) {
    return "This order is already linked to a different lead.";
  }
  if (statusIndex(order.current_status) < statusIndex("deposit_received")) {
    return `This order is at ${STATUS_LABELS[order.current_status]}. Record the deposit on the order first, then mark the lead Won.`;
  }
  if (leadCustomerId && order.customer_id !== leadCustomerId) {
    return "This order belongs to a different customer than this lead. Choose an order for the same customer.";
  }
  return null;
}

function OrderSummary({ order }: { order: OrderLike }) {
  return (
    <div className="min-w-0">
      <div className="text-sm font-medium text-slate-900">
        {order.display_id}
        {order.order_reference ? <span className="text-slate-500"> · {order.order_reference}</span> : null}
      </div>
      <div className="text-xs text-slate-500">
        {order.customer_name ?? "Unknown customer"} · {order.customer_mobile ?? "no mobile"} · {STATUS_LABELS[order.current_status]}
      </div>
    </div>
  );
}

export function MarkAsWonDialog({
  leadId,
  leadName,
  onWon,
  beforeOpen,
}: {
  leadId: string;
  leadName?: string;
  onWon?: () => void | Promise<void>;
  // Runs before the dialog opens — callers with unsaved edits use it for the
  // existing discard-confirmation convention so a Won save can't silently
  // overwrite pending input.
  beforeOpen?: () => boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [context, setContext] = useState<Context | null>(null);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, startSearch] = useTransition();
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<OrderLike | null>(null);

  const form = useForm<WonInput>({
    resolver: zodResolver(markAsWonSchema),
    defaultValues: { lead_id: leadId },
  });

  async function openDialog() {
    if (beforeOpen && !beforeOpen()) return;
    setOpen(true);
    setLoading(true);
    setSelected(null);
    setResults([]);
    setSearched(false);
    setTerm("");
    form.reset({ lead_id: leadId });
    try {
      const data = await getMarkAsWonContext(leadId);
      if (!data.ok) {
        toast.error(data.error);
        setOpen(false);
        return;
      }
      setContext(data);
      form.reset({
        lead_id: leadId,
        order_id: data.linkedOrder?.id ?? "",
        expected_linked_order_id: data.linkedOrder?.id ?? null,
        expected_updated_at: data.lead.updated_at,
        replace_linked_order: false,
      });
      if (data.linkedOrder) setSelected(data.linkedOrder);
    } catch {
      toast.error("Could not load the lead. Please try again.");
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  // % and _ are ilike wildcards — strip them before validating so a
  // wildcard-only query can never reach the server as a bare "match all".
  const sanitizedTerm = term.replace(/[%_]/g, "").trim();
  const searchParsed = wonOrderSearchSchema.safeParse({ term: sanitizedTerm });

  function search() {
    if (!searchParsed.success) return;
    startSearch(async () => {
      try {
        setResults(await searchWonLinkOrders({ term: sanitizedTerm }));
        setSearched(true);
      } catch {
        toast.error("Search failed. Please try again.");
      }
    });
  }

  function choose(order: OrderLike) {
    setSelected(order);
    form.setValue("order_id", order.id, { shouldValidate: true });
    form.setValue("replace_linked_order", false);
  }

  const onSubmit = form.handleSubmit(values => {
    start(async () => {
      try {
        const result = await markLeadAsWon(values);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success("Lead marked Won");
        setOpen(false);
        await onWon?.();
        router.refresh();
      } catch {
        toast.error("Could not mark the lead Won. Please try again.");
      }
    });
  });

  const lead = context?.lead;
  const linked = context?.linkedOrder ?? null;
  const replacing = Boolean(linked && selected && linked.id !== selected.id);
  // Unknown statuses fail closed like the server: an unrecognised linked
  // order is neither eligible nor replaceable.
  const linkedStatusIdx = linked ? statusIndex(linked.current_status) : -1;
  const linkedStatusKnown = linkedStatusIdx >= 0;
  const linkedIsEligible = Boolean(
    linked && !linked.is_draft
      && linkedStatusIdx >= statusIndex("deposit_received"),
  );
  const selectedBlocker = lead && selected
    ? blocker(selected, lead.id, lead.customer_id)
    : null;
  const replaceConfirmed = form.watch("replace_linked_order") === true;
  const canConfirm = Boolean(
    selected && !selectedBlocker && !pending
      && !(replacing && (linkedIsEligible || !linkedStatusKnown))
      && (!replacing || linkedIsEligible || !linkedStatusKnown || replaceConfirmed),
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger type="button" onClick={event => { event.preventDefault(); openDialog(); }}
        className="inline-flex min-h-11 sm:min-h-9 items-center justify-center rounded-lg border border-teal-600 bg-white px-4 py-2 text-sm font-medium text-teal-700 hover:bg-teal-50">
        Mark as Won
      </DialogTrigger>
      {/* 44px touch targets on phones: the scoped dialog-close selector
          enlarges the shared primitive's close button only inside this
          dialog, the rest carry h-11 until sm. */}
      <DialogContent className="sm:max-w-lg max-h-[85dvh] overflow-y-auto [&_[data-slot=dialog-close]]:size-11 sm:[&_[data-slot=dialog-close]]:size-7">
        <DialogHeader>
          <DialogTitle>Mark as Won</DialogTitle>
          <DialogDescription>
            {lead?.name ?? leadName ?? "This lead"} — link the order that already has a recorded deposit, then close the lead Won.
          </DialogDescription>
        </DialogHeader>

        {loading ? <p className="text-sm text-slate-500">Loading lead…</p> : null}
        {!loading && lead ? (
          <Form {...form}>
            {/* The portal moves the DOM out of the parent lead form, but
                React still bubbles synthetic events through the component
                tree. Submit and change stop here so confirming Won cannot
                trigger the parent's save or its dirty tracking. */}
            <form onSubmit={event => { event.stopPropagation(); onSubmit(event); }}
              onChange={event => event.stopPropagation()} className="space-y-4">
              {lead.funnel_stage === "Won" ? (
                <p className="text-sm text-slate-600">This lead is already marked Won.</p>
              ) : (
                <>
                  {linked ? (
                    <div className="rounded-lg border border-slate-200 p-3">
                      <p className={LABEL}>Currently linked order</p>
                      <div className="mt-1"><OrderSummary order={linked}/></div>
                      {linked.is_draft || (linkedStatusIdx >= 0 && linkedStatusIdx < statusIndex("deposit_received")) ? (
                        <p className="mt-1 text-xs text-slate-600">
                          This order has not reached Deposit Received — record the deposit on it, or search for the correct order below.
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  <div>
                    <Label htmlFor="won-order-search" className={LABEL}>Find the order</Label>
                    <div className="mt-1 flex gap-2">
                      <Input id="won-order-search" value={term}
                        onChange={event => setTerm(event.target.value)}
                        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); search(); } }}
                        placeholder="Order number, customer or mobile"
                        className="h-11 sm:h-9 border-slate-200"/>
                      <Button type="button" variant="outline" size="lg" onClick={search}
                        className="h-11 sm:h-9"
                        disabled={searching || !searchParsed.success}>
                        <Search aria-hidden/>{searching ? "…" : "Search"}
                      </Button>
                    </div>
                    {searched && results.length === 0 ? (
                      <p className="mt-2 text-xs text-slate-500">No orders matched.</p>
                    ) : null}
                    {results.length > 0 ? (
                      <ul className="mt-2 space-y-1">
                        {results.map(order => (
                          <li key={order.id}>
                            <button type="button" aria-pressed={selected?.id === order.id}
                              onClick={() => choose(order)}
                              className={`w-full rounded-md border px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-teal-600/50 ${
                                selected?.id === order.id ? "border-teal-600 bg-teal-50" : "border-slate-200 hover:bg-slate-50"}`}>
                              <OrderSummary order={order}/>
                              {order.lead_id && order.lead_id !== lead.id ? (
                                <span className="mt-0.5 block text-xs text-red-600">Linked to another lead</span>
                              ) : order.is_draft ? (
                                <span className="mt-0.5 block text-xs text-red-600">Draft consultation</span>
                              ) : null}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <FormField name="order_id" control={form.control}
                      render={() => <FormItem className="mt-1 space-y-0"><FormMessage/></FormItem>}/>
                  </div>

                  {selected ? (
                    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                      <p className={LABEL}>Selected order</p>
                      <div className="mt-1"><OrderSummary order={selected}/></div>
                      {selectedBlocker ? (
                        <p className="mt-2 text-xs font-medium text-red-600">{selectedBlocker}</p>
                      ) : replacing && linked ? (
                        !linkedStatusKnown ? (
                          <p className="mt-2 text-xs font-medium text-red-600">
                            {linked.display_id} is in an unrecognised status — review that order before replacing the link.
                          </p>
                        ) : linkedIsEligible ? (
                          <p className="mt-2 text-xs font-medium text-red-600">
                            {linked.display_id} already has a recorded deposit — confirm that order instead of replacing the link.
                          </p>
                        ) : (
                          <FormField name="replace_linked_order" control={form.control}
                            render={({ field }) => (
                              <FormItem className="mt-2">
                                <label className="flex items-start gap-2 text-xs font-medium text-slate-700">
                                  <FormControl>
                                    <input type="checkbox" checked={field.value === true}
                                      onChange={event => field.onChange(event.target.checked)}
                                      className="mt-0.5"/>
                                  </FormControl>
                                  <span>
                                    Replace the existing link — unlink {linked.display_id} and link {selected.display_id} to this lead instead. Both orders keep their history.
                                  </span>
                                </label>
                                <FormMessage/>
                              </FormItem>
                            )}/>
                        )
                      ) : (
                        <p className="mt-2 text-xs text-slate-600">
                          Check the customer and order above are right — identities are not matched automatically.
                        </p>
                      )}
                    </div>
                  ) : null}

                  <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 sm:gap-3 pt-1">
                    <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending} className="h-11 sm:h-8">Cancel</Button>
                    <Button type="submit" disabled={!canConfirm}
                      className="bg-teal-600 hover:bg-teal-700 text-white h-11 sm:h-8">
                      {pending ? "Marking Won…" : "Confirm and mark Won"}
                    </Button>
                  </div>
                </>
              )}
            </form>
          </Form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
