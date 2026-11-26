"use client";
import { CostBreakdown } from "@/components/orders/cost-breakdown";
import { Button } from "@/components/ui/button";
import { formatSGD } from "@/lib/money";
import { finalQuoteMetrics, type quickQuote, type QuickQuoteData } from "@/lib/pricing/quick-quote";
import { marginBps } from "@/lib/pricing/calculator";
import type { CalculatorValues } from "@/lib/validation/pricing-calculator";
import { FIELD } from "./room-card";

type Result = ReturnType<typeof quickQuote>;
export type SummaryProps = {
  result: Result; values: CalculatorValues; data: QuickQuoteData; override: string | null;
  onOverride: (value: string | null) => void; onDiscount: (value: string) => void; id: string;
};
const pct = (bps: number) => `${(bps / 100).toFixed(1)}%`;

export function FinalPrice({ result, values, data, override, onOverride, id, compact = false }: Omit<SummaryProps, "onDiscount"> & { compact?: boolean }) {
  const metrics = finalQuoteMetrics(result.quote.discountedSaleSgdCents, result.quote.netCostSgdCents, override, result.complete);
  const floor = values.channel === "carousell" ? data.config.minMarginCarousellBps : data.config.minMarginBps;
  const belowFloor = metrics.margin !== null && metrics.margin < floor;
  const value = override ?? (result.complete ? (result.quote.discountedSaleSgdCents / 100).toFixed(2) : "");
  const invalidMessage = override !== null && !metrics.valid ? "Enter a final price greater than S$0, with at most two decimal places." : "";
  const incompleteMessage = !result.complete ? `Estimate incomplete · ${result.issues[0]?.message ?? "Review your rooms."}` : "";
  const floorMessage = belowFloor ? `Below the ${values.channel === "carousell" ? "Carousell " : ""}${pct(floor)} margin floor — review before quoting.` : "";
  const compactFeedback = [invalidMessage, incompleteMessage, floorMessage].filter(Boolean).join(" ");
  return <div className={`rounded-lg bg-teal-50 ${compact ? "p-2" : "p-4"}`}>
    <div className="flex items-center justify-between gap-2"><label htmlFor={`final-${id}`} className="text-sm font-semibold text-slate-900">Final quote (SGD)</label>{override !== null && <span className="text-xs text-teal-700">Manually adjusted</span>}</div>
    <div className={`grid items-center ${compact ? "mt-1 grid-cols-[minmax(0,1fr)_auto] gap-2" : "mt-2 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"}`}>
      <div className="relative min-w-0"><span aria-hidden="true" className="absolute left-3 top-3 text-lg text-slate-700">S$</span><input id={`final-${id}`} aria-invalid={override !== null && !metrics.valid} aria-describedby={`final-help-${id}`} inputMode="decimal" className={`${FIELD} mt-0 pl-11 text-xl font-semibold`} value={value} onChange={(e) => onOverride(e.target.value)} /></div>
      <dl aria-live="polite" aria-atomic="true" className={`flex gap-4 ${compact ? "text-xs" : "text-sm sm:flex-col sm:gap-2"}`}>
        {!compact && <div><dt className="text-slate-600">Profit</dt><dd className="font-semibold">{metrics.profitCents === null ? "—" : formatSGD(metrics.profitCents)}</dd></div>}
        <div><dt className="text-slate-600">Margin</dt><dd className={`font-semibold ${belowFloor ? "text-red-600" : "text-teal-800"}`}>{metrics.margin === null ? "—" : pct(metrics.margin)}</dd></div>
      </dl>
    </div>
    {compact ? <p id={`final-help-${id}`} className={compactFeedback ? "mt-1 line-clamp-2 text-xs font-medium text-red-600" : "sr-only"}>{compactFeedback || "Profit and margin update as you type. Open pricing to use the calculated price."}</p> : <>
      <p id={`final-help-${id}`} className={`mt-2 text-xs ${invalidMessage ? "text-red-600" : "text-slate-600"}`}>{invalidMessage || "Profit and margin update as you type."}</p>
      {override !== null && <Button type="button" variant="ghost" className="mt-1 min-h-11 px-0 text-teal-700" onClick={() => onOverride(null)}>Use calculated price</Button>}
      {incompleteMessage && <p className="mt-2 text-xs font-medium text-red-600">{incompleteMessage}</p>}
      {floorMessage && <p className="mt-2 text-xs font-medium text-red-600">{floorMessage}</p>}
    </>}
  </div>;
}
export function QuoteSummary(props: SummaryProps) {
  const { result, values, override, onOverride, onDiscount, data, id } = props;
  const { quote, complete } = result;
  const rows = [["Standard", quote.saleSgdCents], ["Groupbuy", quote.groupbuySgdCents], ["Discounted", quote.discountedSaleSgdCents]] as const;
  return <div className="min-w-0 space-y-4">
    <div><h2 className="text-lg font-semibold">Quote summary</h2><p className="mt-1 text-sm text-slate-500">{values.rooms.length} rooms · {values.rooms.reduce((n, r) => n + r.windows.length, 0)} coverings</p></div>
    {!complete && <div role="status" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700"><p className="font-medium">Estimate incomplete</p><ul className="mt-1 space-y-1">{result.issues.map((issue, i) => <li key={i}>{issue.message}</li>)}</ul></div>}
    <div><h3 className="mb-2 text-sm font-semibold">Price comparison</h3><table className="w-full table-fixed text-right text-xs sm:text-sm"><thead><tr className="border-b border-slate-200 bg-slate-50"><th className="w-[28%] py-2 text-left"><span className="sr-only">Price type</span></th><th className="py-2">Price (S$)</th><th className="py-2">Profit (S$)</th><th className="py-2">Margin</th></tr></thead><tbody>{rows.map(([label, sale]) => <tr key={label} className="border-b border-slate-100"><th scope="row" className="py-3 text-left font-medium">{label}</th><td>{complete ? (sale / 100).toFixed(2) : "—"}</td><td>{complete ? ((sale - quote.netCostSgdCents) / 100).toFixed(2) : "—"}</td><td>{complete ? pct(marginBps(quote.netCostSgdCents, sale)) : "—"}</td></tr>)}</tbody></table>{values.packageId && <p className="mt-2 text-xs text-slate-500">Package pricing already includes its groupbuy offer; no additional groupbuy discount applies.</p>}</div>
    <label htmlFor={`discount-${id}`} className="block text-sm font-medium">Discount (%)<input id={`discount-${id}`} className={FIELD} inputMode="decimal" value={values.discount} onChange={(e) => onDiscount(e.target.value)} /></label>
    <FinalPrice result={result} values={values} data={data} override={override} onOverride={onOverride} id={id} />
    {complete && <details className="border-t border-slate-200"><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Cost breakdown</summary><div className="space-y-3 text-xs"><CostBreakdown quote={quote} /><dl className="space-y-1"><div className="flex justify-between gap-2"><dt>Automatic installation</dt><dd>{formatSGD(quote.automaticInstallSgdCents)}</dd></div><div className="flex justify-between gap-2"><dt>Additional installation / transport</dt><dd>{formatSGD(quote.transportExtrasSgdCents)}</dd></div><div className="flex justify-between gap-2 border-t pt-2 font-semibold"><dt>Total cost (SGD)</dt><dd>{formatSGD(quote.netCostSgdCents)}</dd></div></dl></div></details>}
    {complete && (quote.packageLines || quote.minimumOrderAdjustmentSgdCents > 0) && <details className="border-t border-slate-200"><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Price adjustments</summary><dl className="space-y-2 text-xs">{quote.packageLines?.map((line) => <div key={line.key} className="flex justify-between gap-3"><dt>{line.label}</dt><dd className="whitespace-nowrap">{formatSGD(line.totalSgdCents)}</dd></div>)}{quote.packageLines && <div className="flex justify-between gap-3"><dt>Other coverings and extras</dt><dd>{formatSGD(quote.saleSgdCents - quote.minimumOrderAdjustmentSgdCents - quote.packageLines.reduce((sum, line) => sum + line.totalSgdCents, 0))}</dd></div>}{quote.minimumOrderAdjustmentSgdCents > 0 && <div className="flex justify-between gap-3"><dt>Minimum order adjustment</dt><dd>{formatSGD(quote.minimumOrderAdjustmentSgdCents)}</dd></div>}</dl></details>}
  </div>;
}
