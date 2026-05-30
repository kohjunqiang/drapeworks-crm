"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="px-3 py-1.5 text-xs sm:text-sm border border-slate-300 rounded hover:bg-white"
    >
      Print
    </button>
  );
}
