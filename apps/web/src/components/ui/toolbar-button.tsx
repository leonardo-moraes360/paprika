import { Toggle as TogglePrimitive } from "@ui-sdk/react/toggle";
import { ToolbarButton as ToolbarButtonPrimitive } from "@ui-sdk/react/toolbar";
import type { ComponentProps } from "react";
import { slot } from "@/lib/utils";
import { iconButtonClasses } from "./icon-button";

const size = "text-fg [&_svg]:size-[18px]";

export type ToolbarButtonProps = Omit<ComponentProps<typeof ToolbarButtonPrimitive>, "aria-label"> & {
  "aria-label": string;
};

export function ToolbarButton({ className, ...props }: ToolbarButtonProps) {
  return (
    <ToolbarButtonPrimitive
      className={slot(`${iconButtonClasses("md", false)} ${size} aria-expanded:bg-select-soft aria-expanded:text-select-soft-ink`, className)}
      {...props}
    />
  );
}

export type ToolbarToggleProps = Omit<ComponentProps<typeof TogglePrimitive>, "aria-label"> & {
  "aria-label": string;
};

export function ToolbarToggle({ className, ...props }: ToolbarToggleProps) {
  return (
    <TogglePrimitive
      className={slot(
        `${iconButtonClasses("md", false)} ${size} data-pressed:bg-select-soft data-pressed:text-select-soft-ink forced-colors:data-pressed:border-2 forced-colors:data-pressed:border-[Highlight]`,
        className,
      )}
      {...props}
    />
  );
}
