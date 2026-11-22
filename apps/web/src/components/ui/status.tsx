/** Região viva de status e o ponto de estado (ADR 0005). */
import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

/**
 * Ponto de estado do tema. As cores vêm das marcas de ADR 0003 (`leaf` conectado, `accent` caído), então
 * trocar o ponto inline da barra superior por esta variante não muda nenhum pixel — PAP-B-033 faz isso.
 */
export const statusDotVariants = cva("size-2 shrink-0 rounded-full", {
  variants: {
    tone: {
      ok: "bg-leaf",
      alert: "bg-accent",
      idle: "bg-ui-muted-foreground",
    },
  },
  defaultVariants: { tone: "ok" },
});

/**
 * Live region educada: anuncia a mudança de estado para leitores de tela (WCAG 4.1.3). O texto continua
 * apenas visualmente escondido, porque o estado já aparece no ponto e na barra superior.
 */
export function StatusLiveRegion({
  className,
  tone,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof statusDotVariants>) {
  return (
    <span
      data-slot="status"
      data-tone={tone ?? "ok"}
      role="status"
      aria-live="polite"
      className={cn("sr-only", className)}
      {...props}
    />
  );
}
