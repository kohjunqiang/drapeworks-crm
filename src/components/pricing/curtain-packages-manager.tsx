"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { AppSelect } from "@/components/ui/app-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  toggleCurtainPackageActive,
  upsertCurtainPackage,
} from "@/lib/actions/product-pricing-settings";
import type {
  CurtainPackageRow,
  PricingPropertyTierRow,
} from "@/lib/db/product-pricing-settings";

type Draft = {
  id?: string;
  name: string;
  propertyTierId: string;
  packageType: "single" | "double";
  priceSgd: string;
  tier2UpgradeSgd: string;
  roomTier2UpgradeSgd: string;
  roomTier2DowngradeSgd: string;
};

const EMPTY: Draft = {
  name: "",
  propertyTierId: "",
  packageType: "double",
  priceSgd: "",
  tier2UpgradeSgd: "",
  roomTier2UpgradeSgd: "",
  roomTier2DowngradeSgd: "",
};

function validate(draft: Draft): Partial<Record<keyof Draft, string>> {
  const errors: Partial<Record<keyof Draft, string>> = {};
  for (const key of ["roomTier2UpgradeSgd", "roomTier2DowngradeSgd"] as const) {
    if (draft[key].trim() && !/^\d+(\.\d{1,2})?$/.test(draft[key].trim())) errors[key] = "Enter a positive amount or leave blank";
  }
  if (!draft.name.trim()) errors.name = "Enter a package name";
  if (!draft.propertyTierId) errors.propertyTierId = "Select a property tier";
  if (!/^\d+(\.\d{1,2})?$/.test(draft.priceSgd.trim())) {
    errors.priceSgd = "Enter a valid price, for example 768 or 768.00";
  }
  if (
    draft.tier2UpgradeSgd.trim() &&
    !/^\d+(\.\d{1,2})?$/.test(draft.tier2UpgradeSgd.trim())
  ) {
    errors.tier2UpgradeSgd = "Enter a valid top-up or leave it blank";
  }
  return errors;
}

export function CurtainPackagesManager({
  initialPackages,
  propertyTiers,
}: {
  initialPackages: CurtainPackageRow[];
  propertyTiers: PricingPropertyTierRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [packages, setPackages] = useState(initialPackages);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const selectedTier = propertyTiers.find(
    (tier) => tier.id === draft.propertyTierId,
  );
  const activeCount = packages.filter((item) => item.isActive).length;

  const tierOptions = useMemo(
    () =>
      propertyTiers.map((tier) => ({
        value: tier.id,
        label: `${tier.label} · ${tier.roomSetCount} room sets`,
      })),
    [propertyTiers],
  );

  function create() {
    setDraft(EMPTY);
    setErrors({});
    setOpen(true);
  }

  function edit(item: CurtainPackageRow) {
    setDraft({
      id: item.id,
      name: item.name,
      propertyTierId: item.propertyTierId,
      packageType: item.packageType,
      priceSgd: item.priceSgd,
      tier2UpgradeSgd: item.tier2UpgradeSgd,
      roomTier2UpgradeSgd: item.roomTier2UpgradeSgd,
      roomTier2DowngradeSgd: item.roomTier2DowngradeSgd,
    });
    setErrors({});
    setOpen(true);
  }

  function save() {
    const nextErrors = validate(draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    startTransition(async () => {
      try {
        const saved = await upsertCurtainPackage({
          isNew: !draft.id,
          id: draft.id,
          name: draft.name,
          property_tier_id: draft.propertyTierId,
          package_type: draft.packageType,
          base_tier: "essential",
          price_sgd: draft.priceSgd,
          tier2_upgrade_sgd: draft.tier2UpgradeSgd,
          room_tier2_upgrade_sgd: draft.roomTier2UpgradeSgd,
          room_tier2_downgrade_sgd: draft.roomTier2DowngradeSgd,
        });
        setPackages((current) => {
          const found = current.some((item) => item.id === saved.id);
          return found
            ? current.map((item) => (item.id === saved.id ? saved : item))
            : [...current, saved];
        });
        setOpen(false);
        toast.success(draft.id ? "Curtain package updated" : "Curtain package created");
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not save package");
      }
    });
  }

  function toggle(item: CurtainPackageRow) {
    if (
      item.isActive &&
      !window.confirm(
        `Archive “${item.name}”? It will disappear from new consultations. Existing orders keep their saved package price.`,
      )
    ) return;
    startTransition(async () => {
      try {
        await toggleCurtainPackageActive(item.id);
        setPackages((current) =>
          current.map((row) =>
            row.id === item.id ? { ...row, isActive: !row.isActive } : row,
          ),
        );
        toast.success(item.isActive ? "Package archived" : "Package reactivated");
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not update package");
      }
    });
  }

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <header className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-slate-900">Curtain packages</h2>
            <Badge variant="outline">{activeCount} active</Badge>
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
            Each package owns its Essential base price and whole-package tier
            top-up. Shared per-room and measured adjustments are below.
          </p>
        </div>
        <Button onClick={create} className="min-h-11 bg-teal-600 text-white hover:bg-teal-700">
          Create curtain package
        </Button>
      </header>

      {packages.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <p className="text-sm font-medium text-slate-800">No curtain packages yet</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-slate-500">
            Create one package for each Single or Double offer. Active packages
            are immediately selectable in new curtain consultations.
          </p>
          <Button onClick={create} variant="outline" className="mt-4 min-h-11">
            Create your first package
          </Button>
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {packages.map((item) => (
            <div
              key={item.id}
              className="grid gap-3 px-4 py-4 sm:grid-cols-2 sm:px-5 lg:grid-cols-[minmax(0,1.5fr)_80px_110px_minmax(0,1.2fr)_120px] lg:items-center"
            >
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-slate-900">{item.name}</p>
                  {!item.isActive && <Badge variant="outline">Archived</Badge>}
                </div>
                <p className="mt-1 text-xs text-slate-500">{item.propertyTierLabel}</p>
              </div>
              <div className="text-xs text-slate-600">
                <span className="font-medium text-slate-800">{item.roomSetCount}</span>{" "}
                room sets
              </div>
              <div className="text-xs text-slate-600">
                <span className="font-medium capitalize text-slate-800">
                  {item.packageType}
                </span>{" "}
                curtain · Essential tier
              </div>
              <div className="text-sm font-semibold text-slate-900">
                <p>S${item.priceSgd} Essential</p>
                <p className="mt-0.5 text-xs font-normal text-slate-500">
                  {item.tier2UpgradeSgd
                    ? `Tier 2 S$${(
                        Number(item.priceSgd) + Number(item.tier2UpgradeSgd)
                      ).toFixed(2)} · +S$${item.tier2UpgradeSgd}`
                    : "Tier 2 not offered"}
                </p>
              </div>
              <div className="flex gap-2 sm:justify-end">
                <Button variant="outline" size="sm" onClick={() => edit(item)} disabled={pending}>
                  Edit
                </Button>
                <Button variant="ghost" size="sm" onClick={() => toggle(item)} disabled={pending}>
                  {item.isActive ? "Archive" : "Reactivate"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{draft.id ? "Edit curtain package" : "Create curtain package"}</DialogTitle>
            <DialogDescription>
              Set the package structure, Essential price, and whole-package
              Tier 2 (Performance / Luxe / Signature) transition.
            </DialogDescription>
          </DialogHeader>

          <div className="min-w-0 space-y-4 overflow-x-hidden overflow-y-auto pr-1">
            <div className="space-y-1.5">
              <Label htmlFor="curtain-package-name">Package name</Label>
              <Input
                id="curtain-package-name"
                autoFocus
                placeholder="e.g. 4RM Essential Groupbuy"
                value={draft.name}
                onChange={(event) => {
                  setDraft((current) => ({ ...current, name: event.target.value }));
                  setErrors((current) => ({ ...current, name: undefined }));
                }}
                aria-invalid={!!errors.name}
              />
              {errors.name && <p className="text-xs text-red-600">{errors.name}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Property tier</Label>
              <AppSelect
                value={draft.propertyTierId}
                onChange={(value) => {
                  setDraft((current) => ({ ...current, propertyTierId: value }));
                  setErrors((current) => ({ ...current, propertyTierId: undefined }));
                }}
                options={tierOptions}
                placeholder="Select property tier"
              />
              {errors.propertyTierId && <p className="text-xs text-red-600">{errors.propertyTierId}</p>}
              {selectedTier && (
                <p className="text-xs text-slate-500">
                  Includes {selectedTier.roomSetCount} room sets. This count comes
                  from the property tier and cannot drift from it.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Package type</Label>
              <AppSelect
                value={draft.packageType}
                onChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    packageType: value as Draft["packageType"],
                  }))
                }
                options={[
                  { value: "single", label: "Single curtain package" },
                  { value: "double", label: "Double curtain package" },
                ]}
              />
              <p className="text-xs text-slate-500">
                Single includes one curtain layer per room set. Double includes
                two. The actual curtain selections are made in the calculator.
              </p>
            </div>

            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5">
              <p className="text-xs font-medium text-slate-700">Starting package tier</p>
              <p className="mt-0.5 text-sm font-medium text-slate-900">Essential</p>
              <p className="mt-1 text-xs text-slate-500">
                Essential is the price anchor for this package.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="curtain-package-price">Base package price</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">S$</span>
                <Input
                  id="curtain-package-price"
                  inputMode="decimal"
                  pattern="\d+(\.\d{1,2})?"
                  placeholder="768.00"
                  value={draft.priceSgd}
                  onChange={(event) => {
                    setDraft((current) => ({ ...current, priceSgd: event.target.value }));
                    setErrors((current) => ({ ...current, priceSgd: undefined }));
                  }}
                  className="pl-10"
                  aria-invalid={!!errors.priceSgd}
                />
              </div>
              {errors.priceSgd && <p className="text-xs text-red-600">{errors.priceSgd}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="curtain-package-tier2-upgrade">
                Essential → Tier 2 (Performance / Luxe / Signature)
              </Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">+S$</span>
                <Input
                  id="curtain-package-tier2-upgrade"
                  inputMode="decimal"
                  pattern="\d+(\.\d{1,2})?"
                  placeholder="300.00"
                  value={draft.tier2UpgradeSgd}
                  onChange={(event) => {
                    setDraft((current) => ({
                      ...current,
                      tier2UpgradeSgd: event.target.value,
                    }));
                    setErrors((current) => ({
                      ...current,
                      tier2UpgradeSgd: undefined,
                    }));
                  }}
                  className="pl-12"
                  aria-invalid={!!errors.tier2UpgradeSgd}
                />
              </div>
              {errors.tier2UpgradeSgd && (
                <p className="text-xs text-red-600">{errors.tier2UpgradeSgd}</p>
              )}
              {draft.tier2UpgradeSgd && /^\d+(\.\d{1,2})?$/.test(draft.tier2UpgradeSgd) &&
                draft.priceSgd && /^\d+(\.\d{1,2})?$/.test(draft.priceSgd) && (
                  <p className="text-xs leading-5 text-slate-500">
                    Tier 2 (P/L/S) package price: S$
                    {(Number(draft.priceSgd) + Number(draft.tier2UpgradeSgd)).toFixed(2)}.
                    Selecting Essential again uses the base package price.
                    Individual room changes use the separate rates below.
                  </p>
                )}
              {!draft.tier2UpgradeSgd && (
                <p className="text-xs text-slate-500">
                  Optional. Leave blank when this package has no whole-package Tier 2 offer.
                </p>
              )}
            </div>
            <div className="space-y-3 border-t pt-4">
              <h3 className="text-sm font-medium">Individual night-curtain tier changes</h3>
              <p className="text-xs text-slate-500">Per room, for this package/property tier. Enter credits as positive amounts. Blank means not configured; 0 explicitly means free. These do not remove a layer.</p>
              {([
                ["roomTier2UpgradeSgd", "Essential → Tier 2 · charge per room"],
                ["roomTier2DowngradeSgd", "Tier 2 → Essential · credit per room"],
              ] as const).map(([key, label]) => (
                <div key={key} className="space-y-1.5">
                  <Label htmlFor={`package-${key}`}>{label}</Label>
                  <Input id={`package-${key}`} inputMode="decimal" placeholder="Not configured"
                    value={draft[key]} aria-invalid={!!errors[key]}
                    onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} />
                  {errors[key] && <p className="text-xs text-red-600">{errors[key]}</p>}
                </div>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending} className="min-h-11">Cancel</Button>
            <Button onClick={save} disabled={pending} className="min-h-11 bg-teal-600 text-white hover:bg-teal-700">
              {pending ? "Saving…" : draft.id ? "Save changes" : "Create package"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
