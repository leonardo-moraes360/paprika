import { Avatar as AvatarPrimitive, AvatarFallback, AvatarImage } from "@ui-sdk/react/avatar";
import type { ComponentProps } from "react";
import { slot } from "@/lib/utils";
import { toneSurface, type AgentTone } from "./agent-tone";

const sizes = {
  md: "size-7 text-xs",
  lg: "size-14 text-2xl",
};

export type AvatarProps = Omit<ComponentProps<typeof AvatarPrimitive>, "children"> & {
  initials: string;
  label?: string;
  src?: string;
  tone?: AgentTone;
  size?: keyof typeof sizes;
};

export function Avatar({ className, initials, label, src, tone = "agent-1", size = "md", ...props }: AvatarProps) {
  return (
    <AvatarPrimitive
      aria-hidden={label ? undefined : true}
      className={slot(
        `inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold forced-colors:border ${sizes[size]} ${toneSurface[tone]}`,
        className,
      )}
      {...props}
    >
      {src ? <AvatarImage src={src} alt={label ?? ""} className="size-full object-cover" /> : null}
      <AvatarFallback className="inline-flex size-full items-center justify-center">
        <span aria-hidden="true">{initials}</span>
        {label ? <span className="sr-only">{label}</span> : null}
      </AvatarFallback>
    </AvatarPrimitive>
  );
}
