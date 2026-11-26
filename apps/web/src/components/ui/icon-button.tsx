import { Button as ButtonPrimitive } from "@ui-sdk/react/button";
import type { ComponentProps } from "react";
import { focusRing, slot } from "@/lib/utils";

const sizes = {
  md: "size-8 [&_svg]:size-[18px]",
  sm: "size-7 [&_svg]:size-4",
  xs: "size-6 [&_svg]:size-3.5",
};

export type IconButtonSize = keyof typeof sizes;

export function iconButtonClasses(size: IconButtonSize, bordered: boolean) {
  return `inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md border text-muted transition-colors motion-reduce:transition-none not-data-pending:not-data-disabled:hover:bg-surface data-disabled:cursor-not-allowed data-disabled:text-field data-pending:cursor-wait forced-colors:data-disabled:text-[GrayText] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:stroke-[1.75] ${focusRing} focus-visible:outline-offset-1 ${bordered ? "border-field" : "border-transparent"} ${sizes[size]}`;
}

export type IconButtonProps = Omit<ComponentProps<typeof ButtonPrimitive>, "aria-label"> & {
  "aria-label": string;
  size?: IconButtonSize;
  bordered?: boolean;
};

export function IconButton({ className, size = "md", bordered = false, ...props }: IconButtonProps) {
  return <ButtonPrimitive className={slot(iconButtonClasses(size, bordered), className)} {...props} />;
}
