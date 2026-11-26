import type { ReactNode } from "react";

export function CoverPreview({ cover, name, custom }: { cover?: string | null; name: string; custom?: ReactNode }) {
  if (cover) return <img src={cover} alt="" draggable={false} className="size-full object-cover object-top" />;
  if (custom) return <div className="size-full">{custom}</div>;
  return (
    <div aria-hidden="true" className="flex size-full items-center justify-center bg-linear-to-br from-yellow to-glow text-[56px] font-bold text-agent-1-ink">
      {(name.trim()[0] ?? "?").toLocaleUpperCase()}
    </div>
  );
}
