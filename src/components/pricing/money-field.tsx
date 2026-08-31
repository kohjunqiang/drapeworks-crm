import { Input } from "@/components/ui/input";

export function MoneyField({
  value,
  onChange,
  disabled,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <div className="relative min-w-28">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
        S$
      </span>
      <Input
        aria-label={ariaLabel}
        inputMode="decimal"
        pattern="\d+(\.\d{1,2})?"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        placeholder="Not set"
        className="pl-9"
      />
    </div>
  );
}
