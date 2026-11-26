import type { ComponentProps } from "react";
import type { AgentColor } from "./agent-tone";
import { Pill } from "./pill";
import type { PinStatus } from "./pin";

export type PinStatusChipProps = Omit<ComponentProps<typeof Pill>, "tone"> & {
  status: PinStatus;
  tone?: AgentColor;
};

export function PinStatusChip({ status, tone = "agent-1", className, ...props }: PinStatusChipProps) {
  return <Pill tone={status === "resolved" ? "green" : status === "claimed" ? tone : "red"} className={className} data-status={status} {...props} />;
}
