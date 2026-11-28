import { WifiOff } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { Pill, PillDot } from "./pill";

export type ConnectionStatusProps = Omit<ComponentProps<typeof Pill>, "tone" | "icon" | "children"> & {
  connected: boolean;
  label: string;
};

export function ConnectionStatus({ className, connected, label, ...props }: ConnectionStatusProps) {
  return (
    <Pill
      role="status"
      data-connected={connected ? "" : undefined}
      tone={connected ? "neutral" : "red"}
      icon={connected ? <PillDot className="bg-green" /> : <WifiOff />}
      className={cn(connected && "bg-panel text-muted", className)}
      {...props}
    >
      {label}
    </Pill>
  );
}
