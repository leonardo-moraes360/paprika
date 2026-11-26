import { Monitor, Moon, Sun } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { SegmentedControl, SegmentedControlItem } from "./segmented-control";

export type ThemeSwitchValue = "system" | "light" | "dark";

export type ThemeSwitchLabels = {
  label: string;
  system: string;
  light: string;
  dark: string;
};

const options = [
  { value: "system", Icon: Monitor },
  { value: "light", Icon: Sun },
  { value: "dark", Icon: Moon },
] as const;

export type ThemeSwitchProps = Omit<ComponentProps<typeof SegmentedControl>, "value" | "onValueChange" | "aria-label" | "children"> & {
  value: ThemeSwitchValue;
  onValueChange: (value: ThemeSwitchValue) => void;
  labels: ThemeSwitchLabels;
  compact?: boolean;
};

export function ThemeSwitch({ value, onValueChange, labels, compact = false, className, ...props }: ThemeSwitchProps) {
  return (
    <SegmentedControl
      aria-label={labels.label}
      value={value}
      onValueChange={(next) => {
        if (next === "system" || next === "light" || next === "dark") onValueChange(next);
      }}
      indicatorClassName="rounded-md"
      className={(state) => cn("h-auto rounded-lg", typeof className === "function" ? className(state) : className)}
      {...props}
    >
      {options.map(({ value: option, Icon }) => (
        <SegmentedControlItem
          key={option}
          value={option}
          iconOnly={compact}
          aria-label={compact ? labels[option] : undefined}
          className={cn("h-7 rounded-md text-sm [&_svg]:size-3.5", compact ? "h-6" : "px-2.5")}
        >
          <Icon aria-hidden="true" />
          {compact ? null : labels[option]}
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  );
}
