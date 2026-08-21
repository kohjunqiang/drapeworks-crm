"use client";

// 收货地址 — where the vendors send the goods.
//
// A list rather than one set of fields, because the business consolidates
// through a forwarder and a forwarder is something you can change, or have two
// of. Today exactly one row is in force: the one marked default, which every
// purchase order prints. A second row is somewhere to put the next one; until
// an ORDER can say which address it ships to, only the default is ever used,
// and this screen says so rather than implying otherwise.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  saveDeliveryVendor,
  toggleDeliveryVendorActive,
} from "@/lib/actions/procurement";
import type { DeliveryVendorRow } from "@/lib/db/procurement";
import { containsChinese } from "@/lib/validation/procurement";

const INPUT =
  "w-full px-3 py-2 border border-slate-200 rounded text-sm bg-white " +
  "focus:outline-none focus:border-teal-500";

type Draft = {
  id?: string;
  label: string;
  shippingMarkCn: string;
  addressCn: string;
  recipientCn: string;
  phone: string;
  isDefault: boolean;
};

const EMPTY: Draft = {
  label: "",
  shippingMarkCn: "",
  addressCn: "",
  recipientCn: "",
  phone: "",
  isDefault: false,
};

function toDraft(row: DeliveryVendorRow): Draft {
  return {
    id: row.id,
    label: row.label,
    // An empty box saves back as null — the round trip has to preserve "not
    // known", never turn it into "".
    shippingMarkCn: row.shipping_mark_cn ?? "",
    addressCn: row.address_cn ?? "",
    recipientCn: row.recipient_cn ?? "",
    phone: row.phone ?? "",
    isDefault: row.is_default,
  };
}

function Field({
  label,
  hint,
  value,
  onChange,
  multiline,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-slate-700 mb-1">
        {label}
      </span>
      {hint && <span className="block text-xs text-slate-500 mb-1">{hint}</span>}
      {multiline ? (
        <textarea
          rows={2}
          className={INPUT}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className={INPUT}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}

function Editor({
  draft,
  onChange,
  onSave,
  onCancel,
  pending,
  /** True when this row is already the default — the box is then not a choice. */
  lockedDefault,
}: {
  draft: Draft;
  onChange: (patch: Partial<Draft>) => void;
  onSave: () => void;
  onCancel: () => void;
  pending: boolean;
  lockedDefault: boolean;
}) {
  return (
    <div className="px-4 py-4 space-y-4 bg-slate-50 border-t border-slate-200">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field
          label="Name"
          hint="What you call this address. Not printed on the document."
          value={draft.label}
          onChange={(label) => onChange({ label })}
          placeholder="e.g. Shenzhen consolidator"
        />
        <Field
          label="Air shipping mark — 空运唛头"
          hint="Written on the packaging."
          value={draft.shippingMarkCn}
          onChange={(shippingMarkCn) => onChange({ shippingMarkCn })}
          placeholder="中文"
        />
        <Field
          label="Warehouse address — 仓库地址"
          value={draft.addressCn}
          onChange={(addressCn) => onChange({ addressCn })}
          placeholder="中文"
          multiline
        />
        <Field
          label="Recipient — 收件人"
          value={draft.recipientCn}
          onChange={(recipientCn) => onChange({ recipientCn })}
          placeholder="中文"
        />
        <Field
          label="Phone — 电话"
          hint="The warehouse's number, not ours."
          value={draft.phone}
          onChange={(phone) => onChange({ phone })}
        />
      </div>

      {/* Warn, never refuse: a mark like BCH-SG-AD76-空 is mostly Latin and is
          exactly right. Same rule as the PO labels. */}
      {draft.addressCn.trim() !== "" && !containsChinese(draft.addressCn) && (
        <p className="text-xs text-amber-700">
          ⚠ The warehouse address has no Chinese in it. It prints on a Chinese
          document exactly as typed.
        </p>
      )}

      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={draft.isDefault}
          disabled={lockedDefault}
          onChange={(e) => onChange({ isDefault: e.target.checked })}
        />
        <span className="text-sm text-slate-700">
          Every purchase order ships here
          {lockedDefault && (
            <span className="text-slate-500">
              {" "}
              — already the case. Tick this on another address to move it.
            </span>
          )}
        </span>
      </label>

      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900"
        >
          Cancel
        </button>
        <Button
          onClick={onSave}
          disabled={pending}
          className="bg-teal-600 hover:bg-teal-700 text-white"
        >
          {pending ? "Saving…" : "Save address"}
        </Button>
      </div>
    </div>
  );
}

export function DeliveryVendorsPanel({
  addresses,
}: {
  addresses: DeliveryVendorRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // The row being edited, or EMPTY-with-no-id for a new one. Null = nothing open.
  const [draft, setDraft] = useState<Draft | null>(null);

  function save() {
    if (!draft) return;
    startTransition(async () => {
      try {
        await saveDeliveryVendor({
          id: draft.id,
          label: draft.label,
          shippingMarkCn: draft.shippingMarkCn,
          addressCn: draft.addressCn,
          recipientCn: draft.recipientCn,
          phone: draft.phone,
          // The first address is the default whether or not the box is ticked:
          // an address nothing uses is not an answer to "where does this ship".
          isDefault: draft.isDefault || addresses.length === 0,
        });
        toast.success("Delivery address saved");
        setDraft(null);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Save failed");
      }
    });
  }

  function toggle(id: string) {
    startTransition(async () => {
      try {
        await toggleDeliveryVendorActive(id);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Update failed");
      }
    });
  }

  return (
    <section className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Delivery address — 收货地址
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Where the factories send the goods.{" "}
            <strong>Air freight only</strong>: 空运唛头 is an <em>air</em>{" "}
            shipping mark and the mark itself ends in 空, so a sea order prints
            no delivery block at all — a wrong shipping mark on a crate is worse
            than none. Blank lines are dropped from the block.
          </p>
        </div>
        {draft == null && (
          <button
            type="button"
            onClick={() => setDraft({ ...EMPTY })}
            className="px-3 py-1.5 text-sm border border-slate-300 rounded hover:bg-slate-50 whitespace-nowrap"
          >
            Add an address
          </button>
        )}
      </div>

      {addresses.length === 0 && draft == null && (
        <p className="px-4 py-4 text-sm text-slate-600">
          No delivery address. Purchase orders generate without the 收货地址
          block until one is added.
        </p>
      )}

      {addresses.map((row) => {
        const editing = draft?.id === row.id;
        return (
          <div key={row.id} className="border-t border-slate-100 first:border-0">
            <div
              className={`px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between ${
                row.is_active ? "" : "bg-slate-50/60"
              }`}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span
                    className={`text-sm font-semibold ${
                      row.is_active ? "text-slate-900" : "text-slate-400"
                    }`}
                  >
                    {row.label}
                  </span>
                  {row.is_default && (
                    <span className="text-[10px] uppercase tracking-wide text-teal-700 border border-teal-200 bg-teal-50 rounded px-1.5 py-0.5">
                      every PO ships here
                    </span>
                  )}
                  {!row.is_active && (
                    <span className="text-xs text-slate-400">archived</span>
                  )}
                </div>
                <div className="mt-1 space-y-0.5 text-xs text-slate-600">
                  {row.shipping_mark_cn && (
                    <p>新加坡空运唛头： {row.shipping_mark_cn}</p>
                  )}
                  {row.address_cn && <p>仓库地址：{row.address_cn}</p>}
                  {row.recipient_cn && <p>收件人：{row.recipient_cn}</p>}
                  {row.phone && <p>电话： {row.phone}</p>}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setDraft(editing ? null : toDraft(row))}
                  disabled={pending}
                  className="text-xs text-slate-500 hover:text-slate-900"
                >
                  {editing ? "Close" : "Edit"}
                </button>
                <button
                  type="button"
                  onClick={() => toggle(row.id)}
                  disabled={pending}
                  className="text-xs text-slate-500 hover:text-red-600"
                >
                  {row.is_active ? "Archive" : "Restore"}
                </button>
              </div>
            </div>

            {editing && draft && (
              <Editor
                draft={draft}
                onChange={(patch) => setDraft({ ...draft, ...patch })}
                onSave={save}
                onCancel={() => setDraft(null)}
                pending={pending}
                lockedDefault={row.is_default}
              />
            )}
          </div>
        );
      })}

      {draft != null && draft.id == null && (
        <Editor
          draft={draft}
          onChange={(patch) => setDraft({ ...draft, ...patch })}
          onSave={save}
          onCancel={() => setDraft(null)}
          pending={pending}
          lockedDefault={false}
        />
      )}
    </section>
  );
}
