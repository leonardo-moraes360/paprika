import { Popover, PopoverContent, PopoverTrigger } from "@ui-sdk/react/popover";
import type { ComponentProps, ReactNode } from "react";
import { cn, focusRing } from "@/lib/utils";

export type ColorFieldProps = Omit<ComponentProps<typeof PopoverTrigger>, "children" | "value"> & {
  value: string | null;
  emptyLabel: string;
  popoverLabel: string;
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function ColorField({ value, emptyLabel, popoverLabel, children, open, defaultOpen, onOpenChange, className, ...props }: ColorFieldProps) {
  return (
    <Popover open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      <PopoverTrigger
        className={(state) =>
          cn(
            `group/color-field flex h-9 w-full cursor-pointer items-center gap-2 rounded-md text-left text-base text-fg data-disabled:cursor-not-allowed ${focusRing}`,
            typeof className === "function" ? className(state) : className,
          )
        }
        {...props}
      >
        {value ? (
          <span aria-hidden="true" style={{ backgroundColor: value }} className="size-7 shrink-0 rounded-sm border border-field" />
        ) : (
          <span aria-hidden="true" className="relative size-7 shrink-0 overflow-hidden rounded-sm border border-field">
            <span className="absolute top-3 -left-1 h-[1.5px] w-9 -rotate-45 bg-red-ink" />
          </span>
        )}
        <span
          className={cn(
            "flex h-9 min-w-0 flex-1 items-center rounded-md border border-field bg-field-bg px-3 group-data-open/color-field:border-[1.5px] group-data-open/color-field:border-select group-data-disabled/color-field:border-line group-data-disabled/color-field:bg-surface forced-colors:group-data-open/color-field:border-2 forced-colors:group-data-open/color-field:border-[Highlight]",
            value ? "text-fg" : "text-muted",
          )}
        >
          <span className="truncate">{value ?? emptyLabel}</span>
        </span>
      </PopoverTrigger>
      <PopoverContent
        aria-label={popoverLabel}
        className="z-50 rounded-lg border border-line bg-popover p-3 text-fg shadow-popover outline-none"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
