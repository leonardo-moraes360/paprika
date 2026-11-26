import { Button as ButtonPrimitive } from "@ui-sdk/react/button";
import { Code } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { focusRing, slot } from "@/lib/utils";

type CodeButtonBaseProps = Omit<ComponentProps<typeof ButtonPrimitive>, "children" | "aria-expanded" | "aria-controls"> & {
  children?: ReactNode;
};

export type CodeButtonProps = CodeButtonBaseProps &
  ({ open?: undefined; controls?: undefined } | { open: boolean; controls: string });

export function CodeButton({ className, children, open, controls, ...props }: CodeButtonProps) {
  return (
    <ButtonPrimitive
      aria-expanded={open}
      aria-controls={controls}
      className={slot(
        `group/code-button inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-panel px-3 text-sm font-semibold whitespace-nowrap text-fg transition-colors motion-reduce:transition-none not-data-pending:not-data-disabled:hover:bg-surface aria-expanded:border-[1.5px] aria-expanded:border-select aria-expanded:bg-select-soft aria-expanded:text-select-soft-fg forced-colors:aria-expanded:border-2 forced-colors:aria-expanded:border-[Highlight] data-disabled:cursor-not-allowed data-disabled:opacity-50 data-pending:cursor-wait [&_svg]:pointer-events-none [&_svg]:shrink-0 ${focusRing}`,
        className,
      )}
      {...props}
    >
      <Code aria-hidden="true" className="size-4 group-aria-expanded/code-button:text-select-soft-ink" />
      {children}
    </ButtonPrimitive>
  );
}
