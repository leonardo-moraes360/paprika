import type { LucideIcon } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "./toggle-group";
import { cn } from "../../lib/cn";

export interface IconToggleItem<V extends string> {
  value: V;
  label: string;
  icon: LucideIcon;
}

interface Props<V extends string> {
  label: string;
  items: readonly IconToggleItem<V>[];
  value: V | null;
  onValueChange(value: V): void;
  disabled?: boolean;
  className?: string;
  testId?: string;
}

export function IconToggleGroup<V extends string>({ label, items, value, onValueChange, disabled, className, testId }: Props<V>) {
  return (
    <ToggleGroup
      type="single"
      value={value ?? ""}
      disabled={disabled}
      aria-label={label}
      data-testid={testId}
      className={cn("inline-flex w-fit gap-0 rounded-md border border-ui-input bg-ui-field p-0.5", disabled && "opacity-45", className)}
      onValueChange={(next) => {
        if (next) onValueChange(next as V);
      }}
    >
      {items.map(({ value: v, label: itemLabel, icon: Icon }) => (
        <ToggleGroupItem
          key={v}
          value={v}
          size="sm"
          aria-label={itemLabel}
          title={itemLabel}
          data-testid={testId ? `${testId}-${v}` : undefined}
          className="h-6 min-w-8 rounded-sm border-0 focus-visible:outline-solid px-1.5 text-ui-muted-foreground data-[state=on]:bg-ui-secondary-hover data-[state=on]:text-ui-foreground"
        >
          <Icon aria-hidden />
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
