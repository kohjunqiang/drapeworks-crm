"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { saveProcurementSettings } from "@/lib/actions/procurement";
import type { ProcurementSettingsRow } from "@/lib/db/procurement";

// The company facts a 采购订单 prints, grouped the way they appear on the page
// so somebody holding a printed PO can follow along from top to bottom:
// letterhead, then 收货地址, then 订单资料.

const INPUT =
  "w-full px-3 py-2 border border-slate-200 rounded text-sm bg-white " +
  "focus:outline-none focus:border-teal-500";

type Values = {
  companyName: string;
  companyUen: string;
  addressLine1: string;
  addressLine2: string;
  phone: string;
  wechat: string;
  website: string;
  airShippingMark: string;
  warehouseAddressCn: string;
  recipientCn: string;
  deliveryPhone: string;
  trackNoteCn: string;
  curtainStyleCn: string;
  heatSettingCn: string;
  floorClearanceCm: string;
};

type FieldKey = keyof Values;

function toValues(row: ProcurementSettingsRow): Values {
  return {
    companyName: row.company_name,
    companyUen: row.company_uen,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    phone: row.phone,
    wechat: row.wechat,
    website: row.website,
    // Null renders as an empty box and an empty box saves back as null — the
    // round trip has to preserve "not known", never turn it into "".
    airShippingMark: row.air_shipping_mark ?? "",
    warehouseAddressCn: row.warehouse_address_cn ?? "",
    recipientCn: row.recipient_cn ?? "",
    deliveryPhone: row.delivery_phone ?? "",
    trackNoteCn: row.track_note_cn ?? "",
    curtainStyleCn: row.curtain_style_cn ?? "",
    heatSettingCn: row.heat_setting_cn ?? "",
    floorClearanceCm:
      row.floor_clearance_cm == null ? "" : String(row.floor_clearance_cm),
  };
}

function Field({
  label,
  hint,
  name,
  value,
  onChange,
  placeholder,
  multiline,
}: {
  label: string;
  hint?: string;
  name: FieldKey;
  value: string;
  onChange: (name: FieldKey, value: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-slate-700 mb-1">
        {label}
      </span>
      {multiline ? (
        <textarea
          rows={2}
          className={INPUT}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(name, e.target.value)}
        />
      ) : (
        <input
          className={INPUT}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(name, e.target.value)}
        />
      )}
      {hint && <span className="block text-xs text-slate-500 mt-1">{hint}</span>}
    </label>
  );
}

export function ProcurementSettingsForm({
  settings,
}: {
  settings: ProcurementSettingsRow;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const stored = useMemo(() => toValues(settings), [settings]);
  const [saved, setSaved] = useState<Values>(stored);
  const [draft, setDraft] = useState<Values>(stored);

  function onChange(name: FieldKey, value: string) {
    setDraft((d) => ({ ...d, [name]: value }));
  }

  const dirty = (Object.keys(draft) as FieldKey[]).some(
    (k) => draft[k].trim() !== saved[k].trim(),
  );

  function save() {
    startTransition(async () => {
      try {
        await saveProcurementSettings(draft);
        setSaved(draft);
        toast.success("Procurement settings saved");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Save failed");
      }
    });
  }

  return (
    <section className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <div className="px-4 py-4 border-b border-slate-200">
        <h2 className="text-base font-semibold text-slate-900">
          Company &amp; delivery
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          The blocks that are identical on every purchase order, in the order
          they appear on the page.
        </p>
      </div>

      <div className="px-4 py-4 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Letterhead — top left of every PO
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Printed on all three sample documents unchanged. Required.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field
            label="Company name"
            name="companyName"
            value={draft.companyName}
            onChange={onChange}
          />
          <Field
            label="UEN"
            name="companyUen"
            value={draft.companyUen}
            onChange={onChange}
          />
          <Field
            label="Address line 1"
            name="addressLine1"
            value={draft.addressLine1}
            onChange={onChange}
          />
          <Field
            label="Address line 2"
            name="addressLine2"
            value={draft.addressLine2}
            onChange={onChange}
          />
          <Field
            label="Phone — 电话"
            name="phone"
            value={draft.phone}
            onChange={onChange}
          />
          <Field
            label="WeChat — 微信"
            hint="How the vendors are actually reached."
            name="wechat"
            value={draft.wechat}
            onChange={onChange}
          />
          <Field
            label="Website — 网站"
            name="website"
            value={draft.website}
            onChange={onChange}
          />
        </div>
      </div>

      <div className="px-4 py-4 space-y-4 border-t border-slate-200">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Delivery address — 收货地址
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            <strong>Air freight only.</strong> 空运唛头 is an <em>air</em>{" "}
            shipping mark and the mark itself ends in 空, so this block is
            printed only when the order ships by air. What a sea shipment should
            print instead is still an open question, and a wrong shipping mark
            on a crate is worse than no block at all — so a sea order omits it
            entirely. Blank fields are dropped from the block.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field
            label="Air shipping mark — 空运唛头"
            hint="Written on the packaging."
            name="airShippingMark"
            value={draft.airShippingMark}
            onChange={onChange}
            placeholder="中文"
          />
          <Field
            label="Warehouse address — 仓库地址"
            name="warehouseAddressCn"
            value={draft.warehouseAddressCn}
            onChange={onChange}
            placeholder="中文"
            multiline
          />
          <Field
            label="Recipient — 收件人"
            name="recipientCn"
            value={draft.recipientCn}
            onChange={onChange}
            placeholder="中文"
          />
          <Field
            label="Delivery phone — 电话"
            hint="The warehouse's number, not ours."
            name="deliveryPhone"
            value={draft.deliveryPhone}
            onChange={onChange}
          />
        </div>
      </div>

      <div className="px-4 py-4 space-y-4 border-t border-slate-200">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Track order — 轨道
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            The standing lines at the foot of every rail order. The widths above
            them are worked out per window from what was measured; this is the
            part that is the same every time. Typed exactly as it should be
            sent — nothing here is corrected on the way out.
          </p>
        </div>
        <Field
          label="Standing instructions — 备注"
          hint="One instruction per line. Blank leaves the order as just the widths."
          name="trackNoteCn"
          value={draft.trackNoteCn}
          onChange={onChange}
          placeholder="多陪连接器和滑轨"
          multiline
        />
      </div>

      <div className="px-4 py-4 space-y-4 border-t border-slate-200">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Order details — 订单资料
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            <strong>Curtain POs only.</strong> All four of these labels are
            printed but left blank on the Blinds sample, by design — a blind has
            no style, no heat setting and no floor clearance. 窗帘褶皱
            (fullness) is not here: it comes from the style multiplier on
            Pricing Settings.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field
            label="Curtain style — 窗帘款式"
            name="curtainStyleCn"
            value={draft.curtainStyleCn}
            onChange={onChange}
            placeholder="中文"
          />
          <Field
            label="Heat setting — 定型"
            name="heatSettingCn"
            value={draft.heatSettingCn}
            onChange={onChange}
            placeholder="中文"
          />
          <Field
            label="Floor clearance — 窗帘离地 (cm)"
            hint="Whole centimetres, 0–100. Blank prints nothing beside the label."
            name="floorClearanceCm"
            value={draft.floorClearanceCm}
            onChange={onChange}
            placeholder="e.g. 2"
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 px-4 py-3 border-t border-slate-200 bg-slate-50">
        {dirty && !pending && (
          <span className="text-xs text-amber-700">Unsaved changes</span>
        )}
        <Button
          onClick={save}
          disabled={pending || !dirty}
          className="bg-teal-600 hover:bg-teal-700 text-white"
        >
          {pending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </section>
  );
}
