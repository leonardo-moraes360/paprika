import { CircleAlert, Info } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const tones = {
  error: { Icon: CircleAlert, text: "text-red-ink font-semibold", role: "alert" as const },
  info: { Icon: Info, text: "text-muted", role: "status" as const },
};

export type InlineNoticeProps = ComponentProps<"p"> & {
  tone?: keyof typeof tones;
};

export function InlineNotice({ tone = "info", className, children, ...props }: InlineNoticeProps) {
  const { Icon, text, role } = tones[tone];
  return (
    <p role={role} className={cn("flex items-start gap-1.5 text-xs", text, className)} {...props}>
      <Icon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
