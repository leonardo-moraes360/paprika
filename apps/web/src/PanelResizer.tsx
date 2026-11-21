import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cx } from "./ui";

/** Limites de um painel lateral redimensionável (px). */
export interface PanelLimits {
  min: number;
  max: number;
  initial: number;
}

export const LEFT_PANEL: PanelLimits = { min: 200, max: 480, initial: 240 };
export const RIGHT_PANEL: PanelLimits = { min: 240, max: 480, initial: 280 };

const STEP = 16;

const clamp = (w: number, { min, max }: PanelLimits) => Math.round(Math.min(max, Math.max(min, w)));

function readWidth(key: string, limits: PanelLimits): number {
  try {
    const raw = localStorage.getItem(key);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? clamp(n, limits) : limits.initial;
  } catch {
    return limits.initial; // storage bloqueado (janela privada, sandbox)
  }
}

function saveWidth(key: string, w: number) {
  try {
    localStorage.setItem(key, String(w));
  } catch {
    /* sem storage: a largura vale só nesta aba */
  }
}

/** Largura persistida em localStorage, sempre dentro de [min, max]. */
export function usePanelWidth(key: string, limits: PanelLimits) {
  const [width, setWidthState] = useState(() => readWidth(key, limits));
  const setWidth = useCallback(
    (w: number, persist = true) => {
      const next = clamp(w, limits);
      setWidthState(next);
      if (persist) saveWidth(key, next);
    },
    [key, limits],
  );
  return [width, setWidth] as const;
}

/**
 * Alça de arraste na borda interna de um painel lateral. `side` diz de que lado o painel está:
 * na esquerda, arrastar para a direita alarga; na direita, arrastar para a esquerda alarga.
 * Teclado: ←/→ (Shift = passo maior), Home/End = mínimo/máximo; duplo clique volta ao padrão.
 */
export function PanelResizer({
  side,
  label,
  width,
  limits,
  onChange,
}: {
  side: "left" | "right";
  label: string;
  width: number;
  limits: PanelLimits;
  onChange: (w: number, persist?: boolean) => void;
}) {
  const drag = useRef<{ x: number; w: number; last: number } | null>(null);
  const [active, setActive] = useState(false);
  const dir = side === "left" ? 1 : -1;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, w: width, last: width };
    setActive(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    d.last = d.w + (e.clientX - d.x) * dir;
    onChange(d.last, false); // grava só ao soltar, não a cada movimento
  };
  const end = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setActive(false);
    onChange(d.last);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? STEP * 4 : STEP;
    const keys: Record<string, number> = {
      ArrowRight: width + step * dir,
      ArrowLeft: width - step * dir,
      Home: limits.min,
      End: limits.max,
    };
    if (!(e.key in keys)) return;
    e.preventDefault();
    onChange(keys[e.key]!);
  };

  return (
    <div
      className={cx(
        // The handle splits the panel's grid cell and sits over its border; the bar is the ::after.
        "relative z-5 w-[9px] cursor-col-resize touch-none overflow-auto bg-panel outline-none max-wide:hidden",
        "after:absolute after:inset-y-0 after:inset-x-0.75 after:rounded-xs after:transition-[background] after:duration-120",
        side === "left" ? "-mr-1.25 justify-self-end border-r border-line [grid-area:left]" : "-ml-1.25 justify-self-start border-l border-line [grid-area:right]",
        active ? "after:bg-accent" : "hover:after:bg-line focus-visible:after:bg-accent",
      )}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={limits.min}
      aria-valuemax={limits.max}
      aria-valuenow={width}
      tabIndex={0}
      title={`${label} (duplo clique: ${limits.initial}px)`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={() => onChange(limits.initial)}
      onKeyDown={onKeyDown}
    />
  );
}
