/** Abas. Copiado do shadcn/ui (MIT), adaptado ao tema do Paprika — ADR 0005. */
import type { ComponentProps } from "react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { cn } from "../../lib/cn";

export function Tabs({ className, ...props }: ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn("flex flex-col gap-2", className)} {...props} />;
}

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "inline-flex h-8 w-fit items-center justify-center rounded-md bg-ui-muted p-0.5 text-ui-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex h-7 cursor-pointer items-center justify-center whitespace-nowrap rounded-sm px-2.5 text-xs font-semibold transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ui-ring disabled:cursor-default disabled:pointer-events-none disabled:opacity-45 data-[state=active]:bg-ui-card data-[state=active]:text-ui-card-foreground data-[state=active]:shadow-tag",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-ring", className)}
      {...props}
    />
  );
}
