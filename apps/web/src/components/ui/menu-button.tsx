import { Button as ButtonPrimitive } from "@ui-sdk/react/button";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { focusRing, slot } from "@/lib/utils";

export type MenuButtonProps = Omit<ComponentProps<typeof ButtonPrimitive>, "children"> & {
  children?: ReactNode;
  icon?: ReactNode;
};

export function MenuButton({ className, children, icon, ...props }: MenuButtonProps) {
  return (
    <ButtonPrimitive
      className={slot(
        `group/menu-button inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-field bg-panel pr-2 pl-2.5 text-sm font-semibold whitespace-nowrap text-fg transition-colors motion-reduce:transition-none not-data-pending:not-data-disabled:hover:bg-surface data-open:border-[1.5px] data-open:border-select data-open:bg-select-soft data-open:text-select-soft-fg aria-expanded:border-[1.5px] aria-expanded:border-select aria-expanded:bg-select-soft aria-expanded:text-select-soft-fg forced-colors:data-open:border-2 forced-colors:data-open:border-[Highlight] forced-colors:aria-expanded:border-2 forced-colors:aria-expanded:border-[Highlight] data-disabled:cursor-not-allowed data-disabled:opacity-50 data-pending:cursor-wait [&_svg]:pointer-events-none [&_svg]:shrink-0 ${focusRing}`,
        className,
      )}
      {...props}
    >
      {icon ? <span aria-hidden="true" className="inline-flex size-3.5 items-center justify-center text-fg [&_svg]:size-3.5">{icon}</span> : null}
      {children}
      <ChevronDown
        aria-hidden="true"
        className="size-3.5 text-muted group-data-open/menu-button:hidden group-aria-expanded/menu-button:hidden"
      />
      <ChevronUp
        aria-hidden="true"
        className="hidden size-3.5 group-data-open/menu-button:block group-aria-expanded/menu-button:block group-data-open/menu-button:text-select-soft-fg group-aria-expanded/menu-button:text-select-soft-fg"
      />
    </ButtonPrimitive>
  );
}
