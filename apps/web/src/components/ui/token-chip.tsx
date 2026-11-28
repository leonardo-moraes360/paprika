import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type TokenChipProps = Omit<ComponentProps<"span">, "children"> & {
  label: string;
  swatch?: string | null;
  kind?: string;
};

export function TokenChip({ label, swatch, kind, className, ...props }: TokenChipProps) {
  return (
    <span className={cn("inline-flex h-6 max-w-full items-center gap-1.5 rounded-sm bg-surface px-2 text-xs text-fg", className)} {...props}>
      {swatch ? <span aria-hidden="true" style={{ backgroundColor: swatch }} className="size-3 shrink-0 rounded-xs border border-field" /> : null}
      <code className="min-w-0 truncate">{label}</code>
      {kind ? <span className="shrink-0 text-muted">{kind}</span> : null}
    </span>
  );
}
