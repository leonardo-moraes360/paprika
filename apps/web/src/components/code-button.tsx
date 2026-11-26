import { Button as ButtonPrimitive } from "@ui-sdk/react/button";
import { Code } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { focusRing, slot } from "@/lib/utils";

export type CodeButtonProps = Omit<ComponentProps<typeof ButtonPrimitive>, "children"> & {
  children?: ReactNode;
  open?: boolean;
};

export function CodeButton({ className, children, open, ...props }: CodeButtonProps) {
  return (
    <ButtonPrimitive
      aria-expanded={open}
      className={slot(
        `inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-panel px-3 text-sm font-semibold whitespace-nowrap text-fg transition-colors motion-reduce:transition-none not-data-pending:hover:bg-surface aria-expanded:border-[1.5px] aria-expanded:border-select aria-expanded:bg-select-soft data-disabled:pointer-events-none data-disabled:opacity-50 data-pending:cursor-wait [&_svg]:pointer-events-none [&_svg]:shrink-0 ${focusRing}`,
        className,
      )}
      {...props}
    >
      <Code aria-hidden="true" className="size-4 in-aria-expanded:text-select-soft-ink" />
      {children}
    </ButtonPrimitive>
  );
}
