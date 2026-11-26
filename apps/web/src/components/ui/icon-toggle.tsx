import { Toggle as TogglePrimitive } from "@ui-sdk/react/toggle";
import type { ComponentProps } from "react";
import { slot } from "@/lib/utils";
import { iconButtonClasses, type IconButtonSize } from "./icon-button";

export type IconToggleProps = Omit<ComponentProps<typeof TogglePrimitive>, "aria-label"> & {
  "aria-label": string;
  size?: IconButtonSize;
  bordered?: boolean;
};

export function IconToggle({ className, size = "md", bordered = false, ...props }: IconToggleProps) {
  return (
    <TogglePrimitive
      className={slot(
        `${iconButtonClasses(size, bordered)} data-pressed:bg-select-soft data-pressed:text-select-soft-ink forced-colors:data-pressed:border-2 forced-colors:data-pressed:border-[Highlight]`,
        className,
      )}
      {...props}
    />
  );
}
