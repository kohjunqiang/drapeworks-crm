"use client";

import { useEffect, useMemo, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";

import { AppSelect, FormSelect } from "@/components/ui/app-select";
import type { ActivePromotion } from "@/lib/db/promotions";
import type { CurtainPackageRow } from "@/lib/db/product-pricing-settings";

import type { ConsultationShellShape } from "./form-shapes";

const INPUT_CLS =
  "w-full pl-7 pr-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:border-teal-500 bg-white";

// A dollar input whose displayed text stays editable while still reflecting
// values set externally (the live quote auto-fills these fields). We keep a
// local string so typing "12." works, and re-sync from `cents` only when an
// outside change no longer matches what's typed.
function DollarInput({
  cents,
  onCents,
}: {
  cents: number;
  onCents: (cents: number) => void;
}) {
  const [text, setText] = useState(cents ? (cents / 100).toFixed(2) : "");
  const [prevCents, setPrevCents] = useState(cents);

  // Re-sync the displayed text when `cents` changes from the outside (the live
  // quote auto-filling), but not while the user is mid-type. This "adjust state
  // during render" pattern is React's recommended alternative to an effect.
  if (cents !== prevCents) {
    setPrevCents(cents);
    const current = text === "" ? 0 : Math.round(parseFloat(text) * 100);
    if (current !== cents) setText(cents ? (cents / 100).toFixed(2) : "");
  }

  return (
    <div className="relative">
      <span className="absolute left-3 top-2 text-slate-400 text-sm">$</span>
      <input
        type="number"
        step="0.01"
        min="0"
        placeholder="0"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const num = e.target.value === "" ? 0 : parseFloat(e.target.value);
          onCents(Number.isFinite(num) ? Math.round(num * 100) : 0);
        }}
        className={INPUT_CLS}
      />
    </div>
  );
}

// Order-level promotion: pick a preset tier (sets its %) or "Custom %" (reveals
// a % input). Both resolve to one discount on the whole quote — the live quote
// (which margin-tracks the quoted price) recomputes for free.
function PromotionControl({ promotions }: { promotions: ActivePromotion[] }) {
  const { control, setValue } = useFormContext<ConsultationShellShape>();
  const discountBps = useWatch({ control, name: "order.discount_bps" }) ?? 0;
  const promoLabel = useWatch({ control, name: "order.promo_label" });

  // Initial selection derived from persisted values (edit mode).
  const matchedPreset = promoLabel
    ? promotions.find((p) => p.name === promoLabel)
    : undefined;
  const [selection, setSelection] = useState<string>(
    matchedPreset ? matchedPreset.id : discountBps > 0 ? "custom" : "none",
  );
  const [customPct, setCustomPct] = useState<string>(
    !matchedPreset && discountBps > 0 ? (discountBps / 100).toString() : "",
  );

  const setDiscount = (bps: number, label: string | undefined) => {
    setValue("order.discount_bps", bps, { shouldDirty: true });
    setValue("order.promo_label", label, { shouldDirty: true });
  };

  const applyCustom = (pctStr: string) => {
    const pct = pctStr === "" ? 0 : parseFloat(pctStr);
    const clamped = Number.isFinite(pct) ? Math.min(Math.max(pct, 0), 100) : 0;
    setDiscount(Math.round(clamped * 100), undefined);
  };

  const options = [
    ...promotions.map((p) => ({
      value: p.id,
      label: `${p.name} (−${p.discount_bps / 100}%)`,
    })),
    { value: "custom", label: "Custom %" },
  ];

  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">
        Promotion
      </label>
      <AppSelect
        value={selection === "none" ? "" : selection}
        noneLabel="— None —"
        options={options}
        onChange={(v) => {
          const val = v || "none";
          setSelection(val);
          if (val === "none") setDiscount(0, undefined);
          else if (val === "custom") applyCustom(customPct);
          else {
            const p = promotions.find((x) => x.id === val);
            if (p) setDiscount(p.discount_bps, p.name);
          }
        }}
      />
      {selection === "custom" && (
        <div className="relative mt-2">
          <input
            type="number"
            step="0.1"
            min="0"
            max="100"
            placeholder="Discount %"
            value={customPct}
            onChange={(e) => {
              setCustomPct(e.target.value);
              applyCustom(e.target.value);
            }}
            className="w-full pr-7 pl-3 py-2 border border-slate-200 rounded text-sm focus:outline-none focus:border-teal-500 bg-white"
          />
          <span className="absolute right-3 top-2 text-slate-400 text-sm">
            %
          </span>
        </div>
      )}
    </div>
  );
}

export function PricingSection({
  promotions = [],
  curtainPackages = [],
  savedPackageSnapshot,
}: {
  promotions?: ActivePromotion[];
  curtainPackages?: CurtainPackageRow[];
  savedPackageSnapshot?: import("@/lib/pricing/curtain-package-rules").SavedPackageSnapshot;
}) {
  const { control, register, setValue } =
    useFormContext<ConsultationShellShape>();

  const quotedCents =
    useWatch({ control, name: "order.price_quoted_cents" }) ?? 0;
  const depositCents = useWatch({ control, name: "order.deposit_cents" }) ?? 0;
  const extraInstallCents =
    useWatch({ control, name: "order.extra_install_cents" }) ?? 0;
  const balanceCents = Math.max(quotedCents - depositCents, 0);
  const packageId = useWatch({ control, name: "order.curtain_package_id" }) ?? "";
  const packageTier = useWatch({ control, name: "order.curtain_package_tier" }) ?? "essential";
  const currentPackage = curtainPackages.find((item) => item.id === packageId);
  const savedRules = savedPackageSnapshot?.id === packageId ? savedPackageSnapshot.rules : null;
  const selectedPackage = useMemo(() => currentPackage && savedRules ? {
    ...currentPackage, name: savedRules.name, packageType: savedRules.packageType,
    roomSetCount: savedRules.roomSetCount, priceSgd: (savedRules.baseCents / 100).toFixed(2),
    tier2UpgradeSgd: savedRules.tier2UpgradeCents == null ? "" : (savedRules.tier2UpgradeCents / 100).toFixed(2),
  } : currentPackage, [currentPackage, savedRules]);

  // A Tier 2 value can otherwise remain hidden in react-hook-form after the
  // consultant switches to an Essential-only package. Keep what is submitted
  // aligned with what the form actually shows.
  useEffect(() => {
    if ((!selectedPackage || !selectedPackage.tier2UpgradeSgd) && packageTier !== "essential") {
      setValue("order.curtain_package_tier", "essential", {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
  }, [packageTier, selectedPackage, setValue]);

  const setCents = (
    field:
      | "order.price_quoted_cents"
      | "order.deposit_cents"
      | "order.extra_install_cents",
    cents: number,
  ) => setValue(field, cents, { shouldValidate: false, shouldDirty: true });

  return (
    <section className="bg-white rounded-lg border border-slate-200 p-4 sm:p-6 mb-4">
      <h2 className="text-base font-semibold text-slate-900 mb-4">
        Pricing &amp; payment
      </h2>
      {curtainPackages.length > 0 && (
        <div className="mb-4 grid grid-cols-1 gap-3 rounded-md border border-teal-100 bg-teal-50/40 p-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Curtain package</label>
            <FormSelect
              control={control}
              name="order.curtain_package_id"
              options={curtainPackages.map((item) => ({
                value: item.id,
                label: `${item.name} · ${item.packageType} · S$${item.priceSgd}`,
              }))}
              placeholder="No package — use item pricing"
            />
          </div>
          {selectedPackage?.packageType === "single" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Included single layer</label>
              <FormSelect control={control} name="order.curtain_package_single_layer" options={[
                { value: "day", label: "Day curtain included" },
                { value: "night", label: "Night curtain included" },
              ]} />
              <p className="mt-1 text-xs text-slate-500">Select what the base package includes. Adding the other layer or removing this layer uses the configured room rate.</p>
            </div>
          )}
          {selectedPackage && (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Package tier</label>
              <FormSelect
                control={control}
                name="order.curtain_package_tier"
                options={[
                  { value: "essential", label: `Essential · S$${selectedPackage.priceSgd}` },
                  ...(selectedPackage.tier2UpgradeSgd
                    ? [{
                        value: "tier2",
                        label: `Tier 2 (P/L/S) · S$${(
                          Number(selectedPackage.priceSgd) + Number(selectedPackage.tier2UpgradeSgd)
                        ).toFixed(2)}`,
                      }]
                    : []),
                ]}
              />
              <p className="mt-1 text-xs text-slate-500">
                {selectedPackage.roomSetCount} room sets · {selectedPackage.packageType} curtain
              </p>
              <p className="mt-1 text-xs text-slate-500">Room selections determine upgrades and credits. Essential/Signature day curtains are included; Zen adds its room-width rate. Night series names determine Essential, Tier 2 (P/L/S), or Ultimate.</p>
              {savedPackageSnapshot?.id === packageId &&
                savedPackageSnapshot.tier === packageTier && (
                  <p className="mt-1 text-xs font-medium text-teal-700">
                    Saved package rates are in use. Room changes recalculate against these rates, not today&apos;s settings.
                  </p>
                )}
            </div>
          )}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Price quoted (SGD)
          </label>
          <DollarInput
            cents={quotedCents}
            onCents={(c) => setCents("order.price_quoted_cents", c)}
          />
          <input
            type="hidden"
            {...register("order.price_quoted_cents", { valueAsNumber: true })}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Deposit collected
          </label>
          <DollarInput
            cents={depositCents}
            onCents={(c) => setCents("order.deposit_cents", c)}
          />
          <input
            type="hidden"
            {...register("order.deposit_cents", { valueAsNumber: true })}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Balance due
          </label>
          <div className="relative">
            <span className="absolute left-3 top-2 text-slate-400 text-sm">
              $
            </span>
            <input
              type="text"
              readOnly
              value={(balanceCents / 100).toFixed(2)}
              className="w-full pl-7 pr-3 py-2 border border-slate-200 rounded text-sm bg-slate-50 text-slate-700"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mt-3">
        <PromotionControl promotions={promotions} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mt-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Freight
          </label>
          <FormSelect
            control={control}
            name="order.freight_mode"
            options={[
              { value: "air", label: "Air" },
              { value: "sea", label: "Sea" },
            ]}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Sales channel
          </label>
          <FormSelect
            control={control}
            name="order.channel"
            options={[
              { value: "standard", label: "Standard (35% floor)" },
              { value: "carousell", label: "Carousell (30% floor)" },
            ]}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Extra install (transport, etc.)
          </label>
          <DollarInput
            cents={extraInstallCents}
            onCents={(c) => setCents("order.extra_install_cents", c)}
          />
        </div>
      </div>

      <p className="text-xs text-slate-400 mt-2">
        Price quoted &amp; deposit auto-fill from the live quote below — edit to
        override.
      </p>
    </section>
  );
}
