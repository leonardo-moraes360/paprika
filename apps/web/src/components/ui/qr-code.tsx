import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type QrCodeProps = Omit<ComponentProps<"svg">, "children"> & {
  modules: readonly (readonly boolean[])[];
  label: string;
  size?: number;
};

export function QrCode({ modules, label, size = 152, className, ...props }: QrCodeProps) {
  const n = modules.length;
  let path = "";
  modules.forEach((row, y) => {
    row.forEach((on, x) => {
      if (on) path += `M${x} ${y}h1v1h-1z`;
    });
  });
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${n} ${n}`}
      shapeRendering="crispEdges"
      className={cn("shrink-0 rounded-lg border border-line bg-white text-black", className)}
      {...props}
    >
      <path d={path} fill="currentColor" />
    </svg>
  );
}
