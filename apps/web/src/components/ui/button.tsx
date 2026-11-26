import { Button as ButtonPrimitive } from "@ui-sdk/react/button";
import { LoaderCircle } from "lucide-react";
import type { ComponentProps } from "react";
import { focusRing, slot } from "@/lib/utils";

const variants = {
  primary: "bg-action text-on-action not-data-pending:not-data-disabled:hover:bg-action-hover",
  secondary: "border border-field bg-bg text-fg not-data-pending:not-data-disabled:hover:bg-surface",
  ghost: "text-fg not-data-pending:not-data-disabled:hover:bg-surface",
  destructive:
    "border-[1.5px] border-red-ink bg-panel text-red-ink not-data-pending:not-data-disabled:hover:bg-red-soft not-data-pending:not-data-disabled:hover:text-red-soft-ink",
};

const sizes = {
  md: "h-9 px-4.5 text-base",
  sm: "h-7 px-4.5 text-base",
};

export type ButtonProps = ComponentProps<typeof ButtonPrimitive> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
};

export function Button({ className, children, variant = "primary", size = "md", pendingAnnouncement = "", ...props }: ButtonProps) {
  return (
    <ButtonPrimitive
      pendingAnnouncement={pendingAnnouncement}
      className={slot(
        `group/button inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg font-semibold whitespace-nowrap transition-colors motion-reduce:transition-none data-disabled:cursor-not-allowed data-disabled:opacity-50 data-pending:cursor-wait forced-colors:border forced-colors:data-disabled:opacity-100 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 ${focusRing} ${variants[variant]} ${sizes[size]}`,
        className,
      )}
      {...props}
    >
      {(state) => (
        <>
          <LoaderCircle aria-hidden="true" className="hidden size-4 animate-spin group-data-pending/button:block motion-reduce:animate-none" />
          {typeof children === "function" ? children(state) : children}
        </>
      )}
    </ButtonPrimitive>
  );
}
