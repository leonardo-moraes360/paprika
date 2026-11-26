import { Switch as SwitchPrimitive, SwitchThumb } from "@ui-sdk/react/switch";
import type { ComponentProps, ReactNode } from "react";
import { cn, focusRing, slot } from "@/lib/utils";

export type SwitchProps = ComponentProps<typeof SwitchPrimitive> & {
  label?: ReactNode;
  labelClassName?: string;
};

export function Switch({ label, labelClassName, className, ...props }: SwitchProps) {
  return (
    <label className={cn("inline-flex min-h-5.5 cursor-pointer items-center gap-2.5 text-base text-fg has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:text-muted", labelClassName)}>
      <SwitchPrimitive
        className={slot(
          `group/switch relative inline-flex h-5.5 w-10 shrink-0 items-center rounded-full bg-field p-0.5 transition-colors motion-reduce:transition-none data-checked:bg-green data-disabled:cursor-not-allowed data-disabled:bg-line data-disabled:data-checked:bg-field forced-colors:border forced-colors:border-[ButtonText] forced-colors:data-checked:border-2 forced-colors:data-checked:border-[Highlight] forced-colors:data-checked:bg-[Highlight] forced-colors:data-disabled:border-[GrayText] ${focusRing}`,
          className,
        )}
        {...props}
      >
        <SwitchThumb className="size-4.5 rounded-full bg-white transition-transform motion-reduce:transition-none group-data-checked/switch:translate-x-4.5 forced-colors:bg-[ButtonText] forced-colors:group-data-checked/switch:bg-[HighlightText]" />
      </SwitchPrimitive>
      {label}
    </label>
  );
}
