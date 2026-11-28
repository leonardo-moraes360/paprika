import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const columns = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
};

export type PropertyRowProps = Omit<ComponentProps<"div">, "title"> & {
  title?: ReactNode;
  hideTitle?: boolean;
  columns?: keyof typeof columns;
  children: ReactNode;
};

export function PropertyRow({ title, hideTitle = false, columns: count = 2, className, children, ...props }: PropertyRowProps) {
  const id = useId();
  return (
    <div role={title ? "group" : undefined} aria-labelledby={title ? id : undefined} className={cn("flex min-w-0 flex-col gap-1.5", className)} {...props}>
      {title ? (
        <span id={id} className={hideTitle ? "sr-only" : "text-xs font-semibold text-label"}>
          {title}
        </span>
      ) : null}
      <div className={cn("grid min-w-0 items-start gap-2", columns[count])}>{children}</div>
    </div>
  );
}
