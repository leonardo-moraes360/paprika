import { File, X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { IconButton } from "./icon-button";

export type AttachedReferenceProps = Omit<ComponentProps<"div">, "children"> & {
  name: string;
  detail: string;
  icon?: ReactNode;
  removeLabel: string;
  onRemove?: () => void;
};

export function AttachedReference({ className, name, detail, icon, removeLabel, onRemove, ...props }: AttachedReferenceProps) {
  return (
    <div
      className={cn("flex h-9 w-full items-center gap-2 rounded-md border border-line bg-bg pr-1 pl-2.5", className)}
      {...props}
    >
      <span aria-hidden="true" className="inline-flex size-4 shrink-0 items-center justify-center text-muted [&_svg]:size-4 [&_svg]:stroke-[1.75]">
        {icon ?? <File />}
      </span>
      <span className="min-w-0 truncate text-sm font-semibold text-fg">{name}</span>
      <span className="min-w-0 shrink-0 text-xs text-muted">{detail}</span>
      <span aria-hidden="true" className="flex-1" />
      {onRemove ? (
        <IconButton size="sm" aria-label={removeLabel} onClick={onRemove}>
          <X aria-hidden="true" />
        </IconButton>
      ) : null}
    </div>
  );
}
