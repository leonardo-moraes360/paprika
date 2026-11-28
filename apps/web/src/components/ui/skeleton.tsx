import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type SkeletonProps = Omit<ComponentProps<"div">, "children">;

export function Skeleton({ className, ...props }: SkeletonProps) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-sm bg-surface motion-reduce:animate-none forced-colors:border forced-colors:border-[GrayText]", className)} {...props} />;
}
