import { Listbox as ListboxPrimitive, ListboxItem, ListboxItemIndicator, type ListboxProps as ListboxPrimitiveProps } from "@ui-sdk/react/listbox";
import { Check } from "lucide-react";
import type { ComponentProps } from "react";
import type { DistributiveOmit } from "./field-box";
import { slot } from "@/lib/utils";

export type ListProps = DistributiveOmit<Extract<ListboxPrimitiveProps<string, false>, { multiple?: false }>, "multiple">;

export function List({ className, ...props }: ListProps) {
  return <ListboxPrimitive multiple={false} className={slot("flex flex-col gap-0.5 outline-none", className)} {...props} />;
}

export type ListItemProps = ComponentProps<typeof ListboxItem>;

export function ListItem({ className, children, ...props }: ListItemProps) {
  return (
    <ListboxItem
      className={slot(
        "flex h-8 cursor-pointer items-center justify-between gap-2 rounded-sm px-2 text-base text-fg outline-none select-none data-highlighted:bg-surface data-disabled:cursor-not-allowed data-disabled:text-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-select forced-colors:data-highlighted:bg-[Highlight] forced-colors:data-highlighted:text-[HighlightText] forced-colors:data-disabled:text-[GrayText]",
        className,
      )}
      {...props}
    >
      {(state) => (
        <>
          <span className="min-w-0 flex-1 truncate">{typeof children === "function" ? children(state) : children}</span>
          <ListboxItemIndicator>
            <Check aria-hidden="true" className="size-4 shrink-0" />
          </ListboxItemIndicator>
        </>
      )}
    </ListboxItem>
  );
}

