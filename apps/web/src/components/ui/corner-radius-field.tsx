import { Link2, Unlink } from "lucide-react";
import type { ReactNode } from "react";
import { IconToggle } from "./icon-toggle";
import { cn } from "@/lib/utils";

export type CornerRadiusFieldProps = {
  linked: boolean;
  onLinkedChange: (linked: boolean) => void;
  linkLabel: string;
  unlinkLabel: string;
  single: ReactNode;
  corners: { topLeft: ReactNode; topRight: ReactNode; bottomLeft: ReactNode; bottomRight: ReactNode };
  className?: string;
};

export function CornerRadiusField({ linked, onLinkedChange, linkLabel, unlinkLabel, single, corners, className }: CornerRadiusFieldProps) {
  return (
    <div className={cn("flex items-start gap-2", className)}>
      <div className="min-w-0 flex-1">
        {linked ? (
          single
        ) : (
          <div dir="ltr" className="grid grid-cols-2 gap-2">
            {corners.topLeft}
            {corners.topRight}
            {corners.bottomLeft}
            {corners.bottomRight}
          </div>
        )}
      </div>
      <IconToggle
        bordered
        pressed={!linked}
        onPressedChange={(pressed) => onLinkedChange(!pressed)}
        aria-label={linked ? unlinkLabel : linkLabel}
        className="mt-px size-9"
      >
        {linked ? <Link2 aria-hidden="true" /> : <Unlink aria-hidden="true" />}
      </IconToggle>
    </div>
  );
}
