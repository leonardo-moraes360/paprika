import { CircleCheck, Info, OctagonAlert, TriangleAlert } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type Status = "danger" | "warning" | "info" | "success";

const tones = {
  danger: { Icon: OctagonAlert, circle: "bg-red-soft text-red-soft-ink" },
  warning: { Icon: TriangleAlert, circle: "bg-yellow-soft text-yellow-soft-ink" },
  info: { Icon: Info, circle: "bg-select-soft text-select-soft-ink" },
  success: { Icon: CircleCheck, circle: "bg-green-soft text-green-soft-ink" },
};

const sizes = {
  md: "size-7 [&_svg]:size-4",
  lg: "size-9 [&_svg]:size-[18px]",
};

export type StatusIconProps = Omit<ComponentProps<"span">, "children"> & {
  status: Status;
  size?: keyof typeof sizes;
};

export function StatusIcon({ status, size = "md", className, ...props }: StatusIconProps) {
  const { Icon, circle } = tones[status];
  return (
    <span
      data-status={status}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full forced-colors:border forced-colors:border-[CanvasText]", circle, sizes[size], className)}
      {...props}
    >
      <Icon aria-hidden="true" />
    </span>
  );
}
