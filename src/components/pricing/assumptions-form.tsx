"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

import { updatePricingAssumptions } from "@/lib/actions/pricing-settings";
import {
  assumptionsSchema,
  type AssumptionsInput,
} from "@/lib/validation/pricing-settings";

type FieldDef = {
  name: keyof AssumptionsInput;
  label: string;
  prefix?: string; // inline unit on the left (¥, S$, ×)
  suffix?: string; // inline unit on the right (%, /m³)
  placeholder?: string;
};

const GROUPS: { title: string; fields: FieldDef[] }[] = [
  {
    title: "FX & tax",
    fields: [
      { name: "fx", label: "SGD → RMB rate", placeholder: "5.3" },
      { name: "gstPct", label: "GST", suffix: "%" },
      { name: "otherCostPct", label: "Other cost", suffix: "%" },
    ],
  },
  {
    title: "Freight",
    fields: [
      { name: "seaFreightRmb", label: "Sea freight — flat", prefix: "¥", suffix: "/m³" },
      { name: "airFreightRatePct", label: "Air freight — % of curtain cost", suffix: "%" },
      { name: "airFreightFloorRmb", label: "Air freight — min", prefix: "¥" },
      { name: "airFreightCapRmb", label: "Air freight — max", prefix: "¥" },
    ],
  },
  {
    title: "Pricing",
    fields: [
      { name: "groupbuyDiscountPct", label: "Groupbuy discount", suffix: "%" },
      { name: "styleMultiplier", label: "Style multiplier", prefix: "×", placeholder: "2" },
    ],
  },
  {
    title: "Installation (handyman) — cost per window by offering",
    fields: [
      { name: "handymanSingleSgd", label: "Single curtain", prefix: "S$" },
      { name: "handymanDoubleSgd", label: "Double curtain (day+night)", prefix: "S$" },
      { name: "handymanBlindsSgd", label: "Blinds", prefix: "S$" },
      { name: "handymanMeshSgd", label: "Mesh panel (drill + silicone)", prefix: "S$" },
    ],
  },
  {
    title: "Margin floors",
    fields: [
      { name: "minMarginPct", label: "Min margin", suffix: "%" },
      { name: "minMarginCarousellPct", label: "Min margin (Carousell)", suffix: "%" },
    ],
  },
];

export function AssumptionsForm({ values }: { values: AssumptionsInput }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const form = useForm<AssumptionsInput>({
    // coerce.number makes the resolver output diverge from the string field
    // inputs — same one-line cast the other forms use.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(assumptionsSchema) as any,
    defaultValues: values,
  });

  const onSubmit = form.handleSubmit((v) => {
    startTransition(async () => {
      try {
        await updatePricingAssumptions(v);
        toast.success("Assumptions saved");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Save failed");
      }
    });
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-5">
        {GROUPS.map((g) => (
          <div key={g.title}>
            <h3 className="text-sm font-semibold text-slate-700 mb-2">
              {g.title}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {g.fields.map((f) => (
                <FormField
                  key={f.name}
                  name={f.name}
                  control={form.control}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">{f.label}</FormLabel>
                      <FormControl>
                        <div className="relative">
                          {f.prefix && (
                            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                              {f.prefix}
                            </span>
                          )}
                          <Input
                            inputMode="decimal"
                            placeholder={f.placeholder}
                            {...field}
                            value={field.value ?? ""}
                            className={`${f.prefix ? "pl-8" : ""} ${f.suffix ? "pr-10" : ""}`}
                          />
                          {f.suffix && (
                            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                              {f.suffix}
                            </span>
                          )}
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
            </div>
          </div>
        ))}

        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={pending}
            className="bg-teal-600 hover:bg-teal-700 text-white"
          >
            {pending ? "Saving…" : "Save assumptions"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
