import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { flushSync } from "react-dom";
import { PanelLeftOpen, PanelRightOpen } from "lucide-react";
import { Button } from "./components/ui/button";
import { Hint } from "./components/ui/tooltip";
import { cn } from "./lib/cn";

export interface PanelLimits {
  min: number;
  max: number;
  initial: number;
}

export const LEFT_PANEL: PanelLimits = { min: 200, max: 480, initial: 240 };
export const RIGHT_PANEL: PanelLimits = { min: 240, max: 480, initial: 280 };

const STEP = 16;
const COLLAPSE_SLACK = 32;

const clamp = (w: number, { min, max }: PanelLimits) => Math.round(Math.min(max, Math.max(min, w)));

function readWidth(key: string, limits: PanelLimits): number {
  try {
    const raw = localStorage.getItem(key);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? clamp(n, limits) : limits.initial;
  } catch {
    return limits.initial;
  }
}

function saveWidth(key: string, w: number) {
  try {
    localStorage.setItem(key, String(w));
  } catch {
    /* sem storage: a largura vale só nesta aba */
  }
}

function readCollapsed(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function saveCollapsed(key: string, collapsed: boolean) {
  try {
    if (collapsed) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {
    /* sem storage: o estado vale só nesta aba */
  }
}

export interface Panel {
  width: number;
  collapsed: boolean;
  setWidth: (w: number, persist?: boolean) => void;
  setCollapsed: (collapsed: boolean) => void;
}

export function usePanel(key: string, limits: PanelLimits): Panel {
  const [width, setWidthState] = useState(() => readWidth(key, limits));
  const [collapsed, setCollapsedState] = useState(() => readCollapsed(`${key}.collapsed`));
  const setWidth = useCallback(
    (w: number, persist = true) => {
      const next = clamp(w, limits);
      setWidthState(next);
      if (persist) saveWidth(key, next);
    },
    [key, limits],
  );
  const setCollapsed = useCallback(
    (next: boolean) => {
      setCollapsedState(next);
      saveCollapsed(`${key}.collapsed`, next);
    },
    [key],
  );
  return { width, collapsed, setWidth, setCollapsed };
}

export function PanelToggle({ side, label, panel }: { side: "left" | "right"; label: string; panel: Panel }) {
  const Icon = side === "left" ? PanelLeftOpen : PanelRightOpen;
  return (
    <Hint label={label}>
      <Button
        variant="secondary"
        size="icon"
        className={cn(
          "absolute top-3 z-10 size-8 rounded-lg border border-ui-border bg-ui-card text-ui-card-foreground shadow-float hover:bg-ui-secondary-hover max-wide:hidden",
          side === "left" ? "left-3" : "right-3",
        )}
        data-panel-toggle={side}
        aria-label={label}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => panel.setCollapsed(false)}
      >
        <Icon size={16} strokeWidth={1.75} aria-hidden />
      </Button>
    </Hint>
  );
}

export function PanelResizer({
  side,
  label,
  panel,
  limits,
}: {
  side: "left" | "right";
  label: string;
  panel: Panel;
  limits: PanelLimits;
}) {
  const { width, setWidth: onChange, setCollapsed } = panel;
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
    onChange(d.last, false);
  };
  const end = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setActive(false);
    if (d.last < limits.min - COLLAPSE_SLACK) {
      onChange(d.w);
      setCollapsed(true);
      return;
    }
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
    const next = keys[e.key]!;
    if (next < limits.min && width === limits.min) {
      flushSync(() => setCollapsed(true));
      document.querySelector<HTMLElement>(`[data-panel-toggle=${side}]`)?.focus();
      return;
    }
    onChange(next);
  };

  if (panel.collapsed) return null;

  return (
    <Hint label={`${label} (duplo clique: ${limits.initial}px)`}>
      <div
        className={cn(
          "relative z-5 w-[9px] cursor-col-resize touch-none overflow-auto bg-ui-card outline-none max-wide:hidden",
          "after:absolute after:inset-y-0 after:inset-x-0.75 after:rounded-xs after:transition-[background] after:duration-120",
          side === "left" ? "-mr-1.25 justify-self-end border-r border-ui-border [grid-area:left]" : "-ml-1.25 justify-self-start border-l border-ui-border [grid-area:right]",
          active ? "after:bg-accent" : "hover:after:bg-ui-border focus-visible:after:bg-accent",
        )}
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-valuemin={limits.min}
        aria-valuemax={limits.max}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
        onDoubleClick={() => onChange(limits.initial)}
        onKeyDown={onKeyDown}
      />
    </Hint>
  );
}
