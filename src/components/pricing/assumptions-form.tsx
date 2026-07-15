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
  hint: string;
};

const GROUPS: { title: string; fields: FieldDef[] }[] = [
  {
    title: "FX & tax",
    fields: [
      { name: "fx", label: "SGD → RMB rate", hint: "e.g. 5.3" },
      { name: "gstPct", label: "GST", hint: "%" },
      { name: "otherCostPct", label: "Other cost", hint: "% of COGS" },
    ],
  },
  {
    title: "Freight",
    fields: [
      { name: "seaFreightRmb", label: "Sea freight", hint: "¥ / m³" },
      { name: "airFreightRatePct", label: "Air freight rate", hint: "% of day+night COGS" },
      { name: "airFreightFloorRmb", label: "Air freight floor", hint: "¥ min" },
      { name: "airFreightCapRmb", label: "Air freight cap", hint: "¥ max" },
    ],
  },
  {
    title: "Pricing",
    fields: [
      { name: "premium", label: "Our premium", hint: "× e.g. 1.15" },
      { name: "groupbuyDiscountPct", label: "Groupbuy discount", hint: "%" },
      { name: "styleMultiplier", label: "Style multiplier", hint: "× e.g. 2" },
      { name: "handymanSgd", label: "Handyman", hint: "S$" },
    ],
  },
  {
    title: "Margin floors",
    fields: [
      { name: "minMarginPct", label: "Min margin", hint: "%" },
      { name: "minMarginCarousellPct", label: "Min margin (Carousell)", hint: "%" },
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
                        <Input
                          inputMode="decimal"
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <p className="text-[11px] text-slate-400">{f.hint}</p>
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
