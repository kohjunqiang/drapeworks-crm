"use client";

// The rail order, ready to paste into WeChat.
//
// One button and a block of text, on purpose. The text is the deliverable —
// what gets sent is exactly what is on screen, so there is nothing to check
// twice — and the copy is a convenience over selecting it by hand, never the
// only way to get at it.

import { useState } from "react";
import { toast } from "sonner";

export function TrackOrderCard({
  title = "Track order",
  text,
  unmeasured,
}: {
  title?: string;
  /** The whole block, already built on the server. */
  text: string;
  /** Windows needing a rail that have no width recorded. */
  unmeasured: string[];
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      // Undefined on http:// origins and in older browsers — the text is on
      // screen and selectable either way, so this says so rather than failing
      // silently.
      if (!navigator.clipboard) {
        toast.error("This browser will not copy for us. Select the text.");
        return;
      }
      await navigator.clipboard.writeText(text);
      setCopied(true);
      // Long enough to read, short enough that a second copy still confirms.
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy. Select the text instead.");
    }
  }

  return (
    <div className="border border-slate-200 rounded overflow-hidden bg-white">
      <div className="bg-slate-50 px-4 py-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-slate-800">
          {title} <span className="text-slate-500">轨道</span>
        </span>
        <button
          type="button"
          onClick={copy}
          className="px-3 py-1.5 text-sm border border-slate-300 rounded hover:bg-slate-50 whitespace-nowrap"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      {unmeasured.length > 0 && (
        <div className="border-t border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm text-amber-900">
            ⚠{" "}
            {unmeasured.length === 1
              ? "This window needs a rail but has no confirmed manufacturing width, so it is not on the list:"
              : "These windows need rails but have no confirmed manufacturing width, so they are not on the list:"}
          </p>
          <ul className="mt-1 space-y-0.5 text-sm text-amber-900/90">
            {unmeasured.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="border-t border-slate-100 px-4 py-3">
        <p className="text-xs text-slate-500 mb-2">
          Widths are the manufacturing widths, allowance already taken off — the
          same figures in the table below.{" "}
          <span className="text-slate-400">
            双轨 is a window carrying both a day and a night curtain; 单轨 is one
            curtain. No piece may exceed 1.60 m, so each rail is cut into as few
            equal sections as that allows — and a 双轨 needs twice as many.
          </span>
        </p>
        {/* Selectable, wrapping, in a font where 1.33 and 1.38 look different. */}
        <pre className="text-sm text-slate-800 font-mono whitespace-pre-wrap break-words select-all">
          {text}
        </pre>
      </div>
    </div>
  );
}
