import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type GalleryMeta = {
  title: string;
  order: number;
};

export function Specimen({ label, note, children, className }: { label: string; note?: string; children: ReactNode; className?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold tracking-wide text-label uppercase">{label}</h3>
      <div className={cn("flex flex-wrap items-center gap-3 rounded-lg border border-line bg-panel p-4", className)}>{children}</div>
      {note ? <p className="text-xs text-muted">{note}</p> : null}
    </div>
  );
}

export function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-1.5">
      <div>{children}</div>
      <span className="text-xs text-muted">{label}</span>
    </div>
  );
}

export function Grid({ children }: { children: ReactNode }) {
  return <div className="grid gap-6 lg:grid-cols-2">{children}</div>;
}
