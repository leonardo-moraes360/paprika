import { Tabs, TabsList as TabsListPrimitive, TabsPanel as TabsPanelPrimitive, TabsTab as TabsTabPrimitive } from "@ui-sdk/react/tabs";
import type { ComponentProps } from "react";
import { focusRing, slot } from "@/lib/utils";

export { Tabs };

export function TabsList({ className, ...props }: ComponentProps<typeof TabsListPrimitive>) {
  return <TabsListPrimitive className={slot("inline-flex h-7.5 w-full items-center gap-0.5 rounded-md border border-field bg-bg p-px", className)} {...props} />;
}

export function TabsTab({ className, ...props }: ComponentProps<typeof TabsTabPrimitive>) {
  return (
    <TabsTabPrimitive
      className={slot(
        `inline-flex h-6 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-sm border border-transparent px-3 text-xs font-medium whitespace-nowrap text-muted transition-colors motion-reduce:transition-none hover:text-fg data-selected:border-field data-selected:bg-surface data-selected:font-semibold data-selected:text-fg data-disabled:cursor-not-allowed data-disabled:text-field forced-colors:data-selected:border-2 forced-colors:data-selected:border-[Highlight] ${focusRing}`,
        className,
      )}
      {...props}
    />
  );
}

export function TabsPanel({ className, ...props }: ComponentProps<typeof TabsPanelPrimitive>) {
  return <TabsPanelPrimitive className={slot(`flex flex-col gap-3 outline-none ${focusRing}`, className)} {...props} />;
}
