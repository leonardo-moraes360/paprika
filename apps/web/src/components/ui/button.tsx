import { Button as ButtonPrimitive } from "@ui-sdk/react/button";
import type { ComponentProps } from "react";
import { focusRing, slot } from "@/lib/utils";

const variants = {
  primary: "bg-action text-on-action not-data-pending:hover:bg-action-hover",
  secondary: "border border-field text-fg not-data-pending:hover:bg-surface",
  ghost: "text-fg not-data-pending:hover:bg-surface",
  destructive: "border border-red-ink bg-panel text-red-ink not-data-pending:hover:bg-red-soft",
};

const sizes = {
  md: "h-9 px-4.5 text-base",
  sm: "h-7 px-4.5 text-sm",
};

export type ButtonProps = ComponentProps<typeof ButtonPrimitive> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
};

export function Button({ className, variant = "primary", size = "md", ...props }: ButtonProps) {
  return (
    <ButtonPrimitive
      className={slot(
        `inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md font-semibold whitespace-nowrap transition-colors motion-reduce:transition-none data-disabled:pointer-events-none data-disabled:opacity-50 data-pending:cursor-wait data-pending:opacity-70 forced-colors:border forced-colors:data-disabled:opacity-100 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 ${focusRing} ${variants[variant]} ${sizes[size]}`,
        className,
      )}
      {...props}
    />
  );
}
