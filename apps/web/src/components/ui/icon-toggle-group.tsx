import type { ReactNode } from "react";
import { SegmentedControl, SegmentedControlItem, type SegmentedControlProps } from "./segmented-control";
import { cn } from "@/lib/utils";

export type IconToggleGroupItem = {
  value: string;
  label: string;
  icon: ReactNode;
  disabled?: boolean;
};

export type IconToggleGroupProps = Omit<SegmentedControlProps, "children" | "value" | "defaultValue" | "onValueChange" | "aria-label" | "className"> & {
  label: string;
  items: readonly IconToggleGroupItem[];
  value: string | null;
  onValueChange: (value: string) => void;
  className?: string;
};

export function IconToggleGroup({ label, items, value, onValueChange, className, ...props }: IconToggleGroupProps) {
  return (
    <SegmentedControl
      aria-label={label}
      value={value}
      onValueChange={(next) => {
        if (next !== null && next !== value) onValueChange(next);
      }}
      className={cn("w-fit", className)}
      {...props}
    >
      {items.map((item) => (
        <SegmentedControlItem key={item.value} value={item.value} iconOnly aria-label={item.label} title={item.label} disabled={item.disabled}>
          {item.icon}
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  );
}
