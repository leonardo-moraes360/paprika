/** Área de texto. Copiado do shadcn/ui (MIT), adaptado ao tema do Paprika — ADR 0005. */
import type { ComponentProps } from "react";
import { cn } from "../../lib/cn";

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-14 w-full min-w-0 resize-y rounded-md border border-ui-input bg-ui-field px-2 py-1.5 text-sm text-ui-foreground transition-colors outline-none placeholder:text-ui-muted-foreground focus-visible:border-ui-ring focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ui-ring disabled:cursor-default disabled:opacity-45",
        "aria-invalid:border-ui-destructive aria-invalid:outline-2 aria-invalid:outline-offset-1 aria-invalid:outline-ui-destructive-text",
        className,
      )}
      {...props}
    />
  );
}
