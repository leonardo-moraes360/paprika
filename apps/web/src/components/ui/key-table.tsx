import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type KeyTableProps = Omit<ComponentProps<"table">, "children"> & {
  headers: readonly string[];
  children: React.ReactNode;
};

export function KeyTable({ className, headers, children, ...props }: KeyTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className={cn("w-full border-collapse text-left text-sm", className)} {...props}>
        <thead>
          <tr className="h-8 bg-surface">
            {headers.map((header, i) => (
              <th key={`${i}-${header}`} scope="col" className="px-3 text-xs font-bold tracking-[0.6px] whitespace-nowrap text-muted uppercase">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr:not(:first-child)]:border-t [&>tr:not(:first-child)]:border-line">{children}</tbody>
      </table>
    </div>
  );
}

export function KeyTableRow({ className, ...props }: ComponentProps<"tr">) {
  return <tr className={cn("h-10 data-removed:text-muted", className)} {...props} />;
}

export type KeyTableCellProps = ComponentProps<"td"> & { mono?: boolean; muted?: boolean; strong?: boolean };

export function KeyTableCell({ className, mono = false, muted = false, strong = false, ...props }: KeyTableCellProps) {
  return <td className={cn("px-3 align-middle", mono && "font-mono text-xs", muted ? "text-muted" : "text-fg", strong && "font-semibold", className)} {...props} />;
}
