import { ChevronRight } from "lucide-react";
import type { ComponentProps } from "react";
import { cn, focusRing } from "@/lib/utils";

export type BreadcrumbItem = {
  label: string;
  href?: string;
  onSelect?: () => void;
};

export type BreadcrumbProps = Omit<ComponentProps<"nav">, "children"> & {
  label: string;
  items: BreadcrumbItem[];
};

const link = `rounded-xs text-sm font-medium text-muted hover:text-fg ${focusRing}`;

export function Breadcrumb({ className, label, items, ...props }: BreadcrumbProps) {
  return (
    <nav aria-label={label} className={cn("h-6", className)} {...props}>
      <ol className="flex h-6 items-center gap-1.5">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${index}-${item.label}`} className="flex min-w-0 items-center gap-1.5">
              {last ? (
                <span aria-current="page" className="truncate text-sm font-semibold text-fg">
                  {item.label}
                </span>
              ) : item.href ? (
                <a href={item.href} onClick={item.onSelect} className={cn(link, "truncate")}>
                  {item.label}
                </a>
              ) : (
                <button type="button" onClick={item.onSelect} className={cn(link, "cursor-pointer truncate")}>
                  {item.label}
                </button>
              )}
              {last ? null : <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 stroke-[1.75] text-muted" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
