import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { Document } from "@paprika/core";
import { useT } from "./i18n";
import { cn } from "./lib/cn";
import { layerIcon, layerLabel } from "./Layers";

interface Props {
  doc: Document;
  ids: string[];
  x: number;
  y: number;
  onSelect(id: string): void;
  onConvert?(): void;
  onClose(): void;
}

export function LayerMenu({ doc, ids, x, y, onSelect, onConvert, onClose }: Props) {
  const m = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [ids]);
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as globalThis.Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
      if (!items.length) return;
      e.preventDefault();
      e.stopPropagation();
      const at = items.findIndex((n) => n === document.activeElement);
      const next = e.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
      items[next]?.focus();
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  const left = Math.max(8, Math.min(x, window.innerWidth - 248));
  const top = Math.max(8, Math.min(y, window.innerHeight - Math.min(ids.length, 8) * 32 - 16));

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={m.layerMenu}
      data-testid="layer-menu"
      className="fixed z-50 max-h-80 min-w-[13rem] overflow-auto rounded-md border border-ui-border bg-ui-popover p-1 text-ui-popover-foreground shadow-float"
      style={{ left, top }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {ids.map((id, i) => {
        const n = doc.nodes[id];
        if (!n) return null;
        const Icon = layerIcon(n);
        return (
          <button
            key={id}
            type="button"
            role="menuitem"
            data-layer-id={id}
            className={cn(
              "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-left text-sm text-ui-popover-foreground outline-none hover:bg-ui-secondary-hover focus-visible:bg-ui-secondary-hover",
              i === 0 && "bg-ui-secondary-hover",
            )}
            onClick={() => onSelect(id)}
          >
            <Icon className="size-3.5 shrink-0 text-ui-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{layerLabel(doc, n)}</span>
          </button>
        );
      })}
      {onConvert && (
        <button
          type="button"
          role="menuitem"
          data-testid="convert-to-path"
          className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-left text-sm text-ui-popover-foreground outline-none hover:bg-ui-secondary-hover focus-visible:bg-ui-secondary-hover"
          onClick={onConvert}
        >
          {m.convertToPath}
        </button>
      )}
    </div>,
    document.body,
  );
}
