import { Button as ButtonPrimitive } from "@ui-sdk/react/button";
import { ChevronDown } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { focusRing, slot } from "@/lib/utils";

export type AgentsTriggerProps = Omit<ComponentProps<typeof ButtonPrimitive>, "children"> & {
  stack: ReactNode;
  label: string;
};

export function AgentsTrigger({ className, stack, label, pendingAnnouncement = "", ...props }: AgentsTriggerProps) {
  return (
    <ButtonPrimitive
      pendingAnnouncement={pendingAnnouncement}
      className={slot(
        `inline-flex h-7 shrink-0 cursor-pointer items-center gap-2 rounded-full border-[1.5px] border-transparent bg-surface pr-[8.5px] pl-[6.5px] text-sm font-semibold whitespace-nowrap text-fg transition-colors motion-reduce:transition-none data-open:border-select data-open:bg-select-soft aria-expanded:border-select aria-expanded:bg-select-soft data-disabled:cursor-not-allowed forced-colors:border-[ButtonBorder] forced-colors:data-open:border-2 forced-colors:data-open:border-[Highlight] forced-colors:aria-expanded:border-2 forced-colors:aria-expanded:border-[Highlight] ${focusRing}`,
        className,
      )}
      {...props}
    >
      {stack}
      {label}
      <ChevronDown aria-hidden="true" className="size-3.5 stroke-[1.75] text-muted" />
    </ButtonPrimitive>
  );
}
