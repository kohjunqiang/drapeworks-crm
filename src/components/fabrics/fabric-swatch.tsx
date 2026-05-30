import { cn } from "@/lib/utils";

type Props = {
  color: string;
  className?: string;
};

export function FabricSwatch({ color, className }: Props) {
  return (
    <div
      className={cn("rounded border border-slate-200", className)}
      style={{ background: color }}
    />
  );
}
