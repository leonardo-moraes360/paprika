import { Button as ButtonPrimitive } from "@ui-sdk/react/button";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { focusRing, slot } from "@/lib/utils";

export type MenuButtonProps = Omit<ComponentProps<typeof ButtonPrimitive>, "children"> & {
  children?: ReactNode;
  icon?: ReactNode;
  open?: boolean;
};

export function MenuButton({ className, children, icon, open, ...props }: MenuButtonProps) {
  return (
    <ButtonPrimitive
      aria-haspopup="menu"
      aria-expanded={open}
      className={slot(
        `group inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-field bg-panel pr-2 pl-2.5 text-sm font-semibold whitespace-nowrap text-fg transition-colors motion-reduce:transition-none not-data-pending:hover:bg-surface aria-expanded:border-[1.5px] aria-expanded:border-select aria-expanded:bg-select-soft aria-expanded:text-select-soft-fg data-disabled:pointer-events-none data-disabled:opacity-50 data-pending:cursor-wait [&_svg]:pointer-events-none [&_svg]:shrink-0 ${focusRing}`,
        className,
      )}
      {...props}
    >
      {icon ? <span aria-hidden="true" className="inline-flex size-3.5 items-center justify-center [&_svg]:size-3.5">{icon}</span> : null}
      {children}
      <ChevronDown aria-hidden="true" className="size-3.5 text-muted group-aria-expanded:hidden" />
      <ChevronUp aria-hidden="true" className="hidden size-3.5 group-aria-expanded:block" />
    </ButtonPrimitive>
  );
}
