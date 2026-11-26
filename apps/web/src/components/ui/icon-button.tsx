import { Button as ButtonPrimitive } from "@ui-sdk/react/button";
import type { ComponentProps } from "react";
import { focusRing, slot } from "@/lib/utils";

const sizes = {
  md: "size-8 [&_svg]:size-[18px]",
  sm: "size-7 [&_svg]:size-4",
  xs: "size-6 [&_svg]:size-3.5",
};

export type IconButtonProps = Omit<ComponentProps<typeof ButtonPrimitive>, "aria-label"> & {
  "aria-label": string;
  size?: keyof typeof sizes;
  bordered?: boolean;
  active?: boolean;
};

export function IconButton({ className, size = "md", bordered = false, active, ...props }: IconButtonProps) {
  return (
    <ButtonPrimitive
      aria-pressed={active}
      data-active={active ? "" : undefined}
      className={slot(
        `inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md border text-muted transition-colors motion-reduce:transition-none not-data-pending:hover:bg-surface not-data-pending:hover:text-fg data-active:bg-select-soft data-active:text-select-soft-ink data-disabled:pointer-events-none data-disabled:text-field data-disabled:hover:bg-transparent data-disabled:hover:text-field data-pending:cursor-wait forced-colors:data-disabled:text-[GrayText] [&_svg]:pointer-events-none [&_svg]:shrink-0 ${focusRing} ${bordered ? "border-field" : "border-transparent"} ${sizes[size]}`,
        className,
      )}
      {...props}
    />
  );
}
