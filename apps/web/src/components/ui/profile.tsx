import { Button as ButtonPrimitive } from "@ui-sdk/react/button";
import { ChevronsUpDown } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { focusRing, slot } from "@/lib/utils";

export type ProfileProps = Omit<ComponentProps<typeof ButtonPrimitive>, "children"> & {
  name: string;
  detail: string;
  avatar: ReactNode;
};

export function Profile({ className, name, detail, avatar, ...props }: ProfileProps) {
  return (
    <ButtonPrimitive
      className={slot(
        `flex h-12 w-full cursor-pointer items-center gap-2.5 rounded-lg pr-2.5 pl-2 text-left transition-colors motion-reduce:transition-none not-data-disabled:hover:bg-surface data-open:bg-surface aria-expanded:bg-surface data-disabled:cursor-not-allowed forced-colors:data-open:border-2 forced-colors:data-open:border-[Highlight] forced-colors:aria-expanded:border-2 forced-colors:aria-expanded:border-[Highlight] ${focusRing}`,
        className,
      )}
      {...props}
    >
      {avatar}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm leading-none font-semibold text-fg">{name}</span>
        <span className="truncate text-xs leading-none text-muted">{detail}</span>
      </span>
      <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 stroke-[1.75] text-muted" />
    </ButtonPrimitive>
  );
}
