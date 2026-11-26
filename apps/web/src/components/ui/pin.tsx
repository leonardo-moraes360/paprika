import { Button as ButtonPrimitive } from "@ui-sdk/react/button";
import type { ComponentProps } from "react";
import { focusRing, slot } from "@/lib/utils";
import { toneSurface, type AgentColor } from "./agent-tone";

export type PinStatus = "open" | "claimed" | "resolved";

const statuses: Record<Exclude<PinStatus, "claimed">, string> = {
  open: "bg-action text-on-action",
  resolved: "bg-green-ink text-on-green",
};

export type PinProps = Omit<ComponentProps<typeof ButtonPrimitive>, "children" | "aria-label"> & {
  "aria-label": string;
  number: number | string;
  status?: PinStatus;
  tone?: AgentColor;
};

export function Pin({ className, number, status = "open", tone = "agent-1", pendingAnnouncement = "", ...props }: PinProps) {
  return (
    <ButtonPrimitive
      pendingAnnouncement={pendingAnnouncement}
      data-status={status}
      className={slot(
        `inline-flex size-[26px] cursor-pointer items-center justify-center rounded-full border-2 border-pin-ring text-xs font-bold shadow-pin forced-colors:border-[CanvasText] forced-colors:bg-[ButtonFace] forced-colors:text-[ButtonText] ${focusRing} focus-visible:outline-offset-1 ${status === "claimed" ? toneSurface[tone] : statuses[status]}`,
        className,
      )}
      {...props}
    >
      {number}
    </ButtonPrimitive>
  );
}
