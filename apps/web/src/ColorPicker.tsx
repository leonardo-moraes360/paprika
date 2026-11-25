import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Pipette } from "lucide-react";
import type { Document } from "@paprika/core";
import { oklchToRgb, readOklch, resolveValue, rgbToOklch } from "@paprika/core";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover";
import { Hint } from "./components/ui/tooltip";
import { useT } from "./i18n";
import { cn } from "./lib/cn";
import { cx, ui } from "./ui";
import { beginCanvasSample, eyeDropperAvailable, eyedropperListening, openEyeDropper, subscribeEyedropper } from "./eyedropper";

type Rgba = { r: number; g: number; b: number; a: number };
type Hsva = { h: number; s: number; v: number; a: number };

const RECENT_KEY = "paprika.recentColors";
const RECENT_MAX = 8;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function round(n: number, d = 0) {
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

function browserColor(s: string) {
  return parseCssColor(s) !== null || /^(oklch|color-mix|color)\(/i.test(s.trim());
}

function isColorString(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (s.startsWith("$")) return true;
  return browserColor(s);
}

function formatOklch(l: number, c: number, h: number, a: number) {
  const r = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
  const body = `${r(Math.min(1, Math.max(0, l)), 3)} ${r(Math.max(0, c), 3)} ${r(((h % 360) + 360) % 360, 1)}`;
  if (a < 1 - 1e-6) return `oklch(${body} / ${r(a, 3)})`;
  return `oklch(${body})`;
}

function parseCssColor(raw: string): Rgba | null {
  const s = raw.trim();
  const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hex) {
    let h = hex[1]!;
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }
  const rgb = s.match(/^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)$/i);
  if (rgb) {
    return {
      r: clamp(Number(rgb[1]), 0, 255),
      g: clamp(Number(rgb[2]), 0, 255),
      b: clamp(Number(rgb[3]), 0, 255),
      a: rgb[4] !== undefined ? clamp(Number(rgb[4]), 0, 1) : 1,
    };
  }
  return null;
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const C = v * s;
  const X = C * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - C;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (h < 60) [rp, gp, bp] = [C, X, 0];
  else if (h < 120) [rp, gp, bp] = [X, C, 0];
  else if (h < 180) [rp, gp, bp] = [0, C, X];
  else if (h < 240) [rp, gp, bp] = [0, X, C];
  else if (h < 300) [rp, gp, bp] = [X, 0, C];
  else [rp, gp, bp] = [C, 0, X];
  return { r: Math.round((rp + m) * 255), g: Math.round((gp + m) * 255), b: Math.round((bp + m) * 255) };
}

function toHex(r: number, g: number, b: number, a = 1): string {
  const h = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
  const base = `#${h(r)}${h(g)}${h(b)}`;
  if (a >= 1 - 1e-6) return base;
  return `${base}${h(a * 255)}`;
}

function toCommit(r: number, g: number, b: number, a: number): string {
  if (a < 1 - 1e-6) return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${round(a, 3)})`;
  return toHex(r, g, b);
}

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function pushRecent(value: string) {
  try {
    const next = [value, ...readRecent().filter((x) => x !== value)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
  }
}

function colorTokens(doc: Document, mode?: string): { name: string; css: string }[] {
  const base = Object.entries(doc.tokens ?? {});
  const modeEntries = mode && doc.modes?.[mode] ? Object.entries(doc.modes[mode]!) : [];
  const seen = new Set<string>();
  const out: { name: string; css: string }[] = [];
  for (const [name, raw] of [...modeEntries, ...base]) {
    if (seen.has(name) || typeof raw !== "string" || !isColorString(raw)) continue;
    seen.add(name);
    const css = String(resolveValue(doc, `$${name}`, mode));
    if (!browserColor(css)) continue;
    out.push({ name, css });
  }
  return out;
}

function hsvaFromValue(doc: Document, value: string | undefined, mode?: string): Hsva {
  const resolved = value ? String(resolveValue(doc, value, mode)) : "#000000";
  const rgba = parseCssColor(resolved) ?? { r: 0, g: 0, b: 0, a: 1 };
  const { h, s, v } = rgbToHsv(rgba.r, rgba.g, rgba.b);
  return { h, s, v, a: rgba.a };
}

function usePointerDrag(
  onMove: (x: number, y: number, el: HTMLElement) => void,
  onEnd?: () => void,
) {
  const dragging = useRef(false);
  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    dragging.current = true;
    onMove(e.clientX, e.clientY, el);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (!dragging.current) return;
    onMove(e.clientX, e.clientY, e.currentTarget);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    onEnd?.();
  };
  return { onPointerDown, onPointerMove, onPointerUp };
}

export function ColorPicker({
  doc,
  label,
  value,
  mode,
  onCommit,
}: {
  doc: Document;
  label: string;
  value: string | undefined;
  mode?: string;
  onCommit(v: string | null): void;
}) {
  const m = useT();
  const [open, setOpen] = useState(false);
  const [hsva, setHsva] = useState<Hsva>(() => hsvaFromValue(doc, value, mode));
  const [hexText, setHexText] = useState("");
  const [rgbText, setRgbText] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [space, setSpace] = useState<"srgb" | "oklch">("srgb");
  const [oklch, setOklch] = useState({ l: 0.62, c: 0.19, h: 35 });
  const spaceRef = useRef(space);
  const oklchRef = useRef(oklch);
  spaceRef.current = space;
  oklchRef.current = oklch;
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const liveId = useId();
  const rgb = hsvToRgb(hsva.h, hsva.s, hsva.v);
  const preview = toCommit(rgb.r, rgb.g, rgb.b, hsva.a);
  const resolvedPreview = value?.startsWith("$") ? String(resolveValue(doc, value, mode)) : preview;
  const triggerCss = value ? String(resolveValue(doc, value, mode)) : "#000000";

  const focusTrigger = () => {
    const el = triggerRef.current;
    if (!el) return;
    if (typeof el.focus === "function") el.focus({ preventScroll: true });
  };

  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) {
      queueMicrotask(focusTrigger);
      requestAnimationFrame(focusTrigger);
    }
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    if (open) return;
    setHsva(hsvaFromValue(doc, value, mode));
  }, [doc, value, mode, open]);

  useEffect(() => {
    if (!open) return;
    setHsva(hsvaFromValue(doc, value, mode));
    const raw = value && !value.startsWith("$") ? value : value ? String(resolveValue(doc, value, mode)) : "";
    const parsed = readOklch(raw);
    if (parsed) {
      setSpace("oklch");
      setOklch(parsed);
    } else setSpace("srgb");
    setRecent(readRecent());
  }, [open, doc, value, mode]);

  useEffect(() => {
    setHexText(toHex(rgb.r, rgb.g, rgb.b, hsva.a));
    setRgbText(`${rgb.r}, ${rgb.g}, ${rgb.b}`);
  }, [rgb.r, rgb.g, rgb.b, hsva.a]);

  const commitColor = (next: string) => {
    pushRecent(next);
    setRecent(readRecent());
    onCommit(next);
  };
  const sampling = useSyncExternalStore(subscribeEyedropper, eyedropperListening, () => false);
  const cancelSample = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelSample.current?.(), []);
  useEffect(() => {
    if (!sampling) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      cancelSample.current?.();
      cancelSample.current = null;
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [sampling]);

  const hsvaRef = useRef(hsva);
  hsvaRef.current = hsva;

  const applyHsva = (next: Hsva, commit = true) => {
    setHsva(next);
    hsvaRef.current = next;
    const { r, g, b } = hsvToRgb(next.h, next.s, next.v);
    if (commit) commitColor(toCommit(r, g, b, next.a));
  };
  const applySample = (raw: string) => {
    const parsed = parseCssColor(raw.trim());
    if (!parsed) {
      commitColor(raw.trim());
      return;
    }
    const { h, s, v } = rgbToHsv(parsed.r, parsed.g, parsed.b);
    applyHsva({ h, s, v, a: parsed.a });
  };
  const pickColor = async () => {
    if (cancelSample.current) {
      cancelSample.current();
      cancelSample.current = null;
      return;
    }
    if (eyeDropperAvailable()) {
      const hex = await openEyeDropper();
      if (hex) applySample(hex);
      return;
    }
    cancelSample.current = beginCanvasSample((color) => {
      cancelSample.current = null;
      applySample(color);
    });
  };

  const commitHsva = () => {
    const cur = hsvaRef.current;
    const { r, g, b } = hsvToRgb(cur.h, cur.s, cur.v);
    commitColor(toCommit(r, g, b, cur.a));
  };

  const applyOklch = (next: { l: number; c: number; h: number }, a = hsvaRef.current.a, commit = true) => {
    setOklch(next);
    const rgbO = oklchToRgb(Math.min(1, Math.max(0, next.l)), Math.max(0, next.c), next.h);
    const hsv = rgbToHsv(rgbO.r, rgbO.g, rgbO.b);
    const hsvaNext = { ...hsv, a };
    setHsva(hsvaNext);
    hsvaRef.current = hsvaNext;
    if (commit) commitColor(formatOklch(next.l, next.c, next.h, a));
  };

  const chooseSpace = (next: "srgb" | "oklch") => {
    setSpace(next);
    if (value?.startsWith("$")) return;
    if (next === "oklch") {
      const o = rgbToOklch(rgb.r, rgb.g, rgb.b);
      applyOklch(o, hsva.a);
    } else commitHsva();
  };

  const setOpenSafe = (next: boolean) => {
    setOpen(next);
  };

  const onSv = (clientX: number, clientY: number, el: HTMLElement) => {
    const box = el.getBoundingClientRect();
    const s = clamp((clientX - box.left) / box.width, 0, 1);
    const v = 1 - clamp((clientY - box.top) / box.height, 0, 1);
    applyHsva({ ...hsvaRef.current, s, v }, false);
  };
  const onHue = (clientX: number, _clientY: number, el: HTMLElement) => {
    const box = el.getBoundingClientRect();
    const h = clamp((clientX - box.left) / box.width, 0, 1) * 360;
    applyHsva({ ...hsvaRef.current, h }, false);
  };
  const onAlpha = (clientX: number, _clientY: number, el: HTMLElement) => {
    const box = el.getBoundingClientRect();
    const a = clamp((clientX - box.left) / box.width, 0, 1);
    applyHsva({ ...hsvaRef.current, a }, false);
  };
  const svDrag = usePointerDrag(onSv, commitHsva);
  const hueDrag = usePointerDrag(onHue, commitHsva);
  const commitLive = () => {
    if (spaceRef.current === "oklch") {
      const o = oklchRef.current;
      commitColor(formatOklch(o.l, o.c, o.h, hsvaRef.current.a));
    } else commitHsva();
  };
  const alphaDrag = usePointerDrag(onAlpha, commitLive);

  const onSvKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    let { s, v } = hsva;
    if (e.key === "ArrowRight") s = clamp(s + step, 0, 1);
    else if (e.key === "ArrowLeft") s = clamp(s - step, 0, 1);
    else if (e.key === "ArrowUp") v = clamp(v + step, 0, 1);
    else if (e.key === "ArrowDown") v = clamp(v - step, 0, 1);
    else return;
    e.preventDefault();
    applyHsva({ ...hsva, s, v });
  };
  const onHueKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 2;
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const h = clamp(hsva.h + (e.key === "ArrowRight" ? step : -step), 0, 360);
    applyHsva({ ...hsva, h });
  };
  const onAlphaKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const a = clamp(hsva.a + (e.key === "ArrowRight" ? step : -step), 0, 1);
    if (space === "oklch") applyOklch(oklch, a);
    else applyHsva({ ...hsva, a });
  };

  const commitHex = () => {
    const parsed = parseCssColor(hexText.startsWith("#") ? hexText : `#${hexText}`);
    if (!parsed) {
      setHexText(toHex(rgb.r, rgb.g, rgb.b, hsva.a));
      return;
    }
    const { h, s, v } = rgbToHsv(parsed.r, parsed.g, parsed.b);
    applyHsva({ h, s, v, a: parsed.a });
  };
  const commitRgb = () => {
    const m = rgbText.match(/^\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*$/);
    if (!m) {
      setRgbText(`${rgb.r}, ${rgb.g}, ${rgb.b}`);
      return;
    }
    const r = clamp(Number(m[1]), 0, 255);
    const g = clamp(Number(m[2]), 0, 255);
    const b = clamp(Number(m[3]), 0, 255);
    const { h, s, v } = rgbToHsv(r, g, b);
    applyHsva({ h, s, v, a: hsva.a });
  };

  const tokens = colorTokens(doc, mode);
  const hueColor = `hsl(${hsva.h} 100% 50%)`;

  return (
    <Popover open={open} onOpenChange={setOpenSafe} modal={false}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          className={ui.colorSwatch}
          style={{ background: triggerCss }}
          aria-label={`${label} (seletor)`}
          aria-haspopup="dialog"
          aria-expanded={open}
          data-testid="color-picker-trigger"
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className={cn(ui.colorPopover, "w-[260px] p-3")}
        data-testid="color-picker"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          focusTrigger();
        }}
        onEscapeKeyDown={(e) => {
          e.stopPropagation();
        }}
        onKeyDownCapture={(e) => {
          if (e.key === "Escape") e.stopPropagation();
        }}
      >
        <div className="grid gap-2.5">
          <p id={liveId} className="m-0 text-2xs font-semibold uppercase tracking-[0.06em] text-muted">
            Cor
          </p>
          <div className="flex gap-1" data-testid="color-space">
            <button type="button" className={cn(ui.colorToken, space === "srgb" && "is-active")} aria-pressed={space === "srgb"} data-testid="color-space-srgb" onClick={() => chooseSpace("srgb")}>
              {m.colorSpaceSrgb}
            </button>
            <button type="button" className={cn(ui.colorToken, space === "oklch" && "is-active")} aria-pressed={space === "oklch"} data-testid="color-space-oklch" onClick={() => chooseSpace("oklch")}>
              {m.colorSpaceOklch}
            </button>
          </div>
          {space === "oklch" ? (
            <div className="grid gap-2">
              {(
                [
                  ["L", m.colorLightness, oklch.l, 1, "color-oklch-l"],
                  ["C", m.colorChroma, oklch.c, 0.4, "color-oklch-c"],
                  ["H", m.colorHue, oklch.h, 360, "color-oklch-h"],
                ] as const
              ).map(([key, label, valueNow, max, testid]) => (
                <div key={key}>
                  <div
                    role="slider"
                    tabIndex={0}
                    aria-label={label}
                    aria-valuemin={0}
                    aria-valuemax={max}
                    aria-valuenow={Math.round(valueNow * (key === "H" ? 1 : 100)) / (key === "H" ? 1 : 100)}
                    data-testid={testid}
                    className={ui.colorSlider}
                    style={{
                      background:
                        key === "L"
                          ? "linear-gradient(to right, #000, #fff)"
                          : key === "C"
                            ? `linear-gradient(to right, ${formatOklch(oklch.l, 0, oklch.h, 1)}, ${formatOklch(oklch.l, 0.4, oklch.h, 1)})`
                            : "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
                    }}
                    onPointerDown={(e) => {
                      const el = e.currentTarget;
                      const move = (ev: PointerEvent) => {
                        const box = el.getBoundingClientRect();
                        const t = clamp((ev.clientX - box.left) / box.width, 0, 1) * max;
                        applyOklch({ ...oklch, [key === "L" ? "l" : key === "C" ? "c" : "h"]: t }, hsvaRef.current.a, false);
                      };
                      move(e.nativeEvent);
                      const up = (ev: PointerEvent) => {
                        window.removeEventListener("pointermove", move);
                        window.removeEventListener("pointerup", up);
                        const box = el.getBoundingClientRect();
                        const t = clamp((ev.clientX - box.left) / box.width, 0, 1) * max;
                        applyOklch({ ...oklch, [key === "L" ? "l" : key === "C" ? "c" : "h"]: t });
                      };
                      window.addEventListener("pointermove", move);
                      window.addEventListener("pointerup", up);
                    }}
                  >
                    <span className={ui.colorThumb} style={{ left: `${(valueNow / max) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
          <>
          <div
            role="slider"
            tabIndex={0}
            aria-label={m.colorSatBri}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(hsva.s * 100)}
            aria-describedby={liveId}
            data-testid="color-sv"
            className={ui.colorSv}
            style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueColor})` }}
            onKeyDown={onSvKey}
            {...svDrag}
          >
            <span
              className={ui.colorCursor}
              style={{ left: `${hsva.s * 100}%`, top: `${(1 - hsva.v) * 100}%` }}
            />
          </div>
          <div
            role="slider"
            tabIndex={0}
            aria-label={m.colorHue}
            aria-valuemin={0}
            aria-valuemax={360}
            aria-valuenow={Math.round(hsva.h)}
            data-testid="color-hue"
            className={ui.colorSlider}
            style={{ background: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)" }}
            onKeyDown={onHueKey}
            {...hueDrag}
          >
            <span className={ui.colorThumb} style={{ left: `${(hsva.h / 360) * 100}%`, background: hueColor }} />
          </div>
          </>
          )}
          <div
            role="slider"
            tabIndex={0}
            aria-label={m.colorAlpha}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(hsva.a * 100)}
            data-testid="color-alpha"
            className={cx(ui.colorSlider, ui.colorAlpha)}
            style={{
              backgroundImage: `linear-gradient(to right, transparent, ${toHex(rgb.r, rgb.g, rgb.b)}), linear-gradient(45deg, #bbb 25%, transparent 25%), linear-gradient(-45deg, #bbb 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #bbb 75%), linear-gradient(-45deg, transparent 75%, #bbb 75%)`,
              backgroundColor: "#eee",
              backgroundSize: "auto, 8px 8px, 8px 8px, 8px 8px, 8px 8px",
              backgroundPosition: "0 0, 0 0, 0 4px, 4px -4px, -4px 0",
            }}
            onKeyDown={onAlphaKey}
            {...alphaDrag}
          >
            <span className={ui.colorThumb} style={{ left: `${hsva.a * 100}%`, background: preview }} />
          </div>
          <div className="flex items-start gap-2">
          <div className="grid min-w-0 flex-1 grid-cols-2 gap-2">
            {space === "oklch" ? (
              <label className={cn(ui.colorChannel, "col-span-2")}>
                <span>OKLCH</span>
                <input
                  aria-label="OKLCH"
                  data-testid="color-oklch"
                  value={formatOklch(oklch.l, oklch.c, oklch.h, hsva.a)}
                  onChange={(e) => {
                    const parsed = readOklch(e.target.value);
                    if (parsed) applyOklch(parsed, parsed.a);
                  }}
                />
              </label>
            ) : (
            <label className={ui.colorChannel}>
              <span>HEX</span>
              <input
                aria-label="HEX"
                data-testid="color-hex"
                value={hexText}
                onChange={(e) => setHexText(e.target.value)}
                onBlur={commitHex}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitHex();
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setOpenSafe(false);
                  }
                }}
              />
            </label>
            )}
            <label className={ui.colorChannel}>
              <span>RGB</span>
              <input
                aria-label="RGB"
                data-testid="color-rgb"
                value={rgbText}
                onChange={(e) => setRgbText(e.target.value)}
                onBlur={commitRgb}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitRgb();
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setOpenSafe(false);
                  }
                }}
              />
            </label>
          </div>
          <button
            type="button"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-select bg-ui-card text-select"
            aria-label={m.colorEyedropper}
            aria-pressed={sampling}
            data-testid="color-eyedropper"
            onClick={() => void pickColor()}
          >
            <Pipette className="size-3.5" aria-hidden />
          </button>
          </div>
          {tokens.length > 0 && (
            <div className="grid gap-1.5">
              <p className="m-0 text-2xs font-semibold text-muted">{m.colorTokens}</p>
              <div className="flex flex-wrap gap-2" data-testid="color-tokens">
                {tokens.map((tok) => (
                  <Hint key={tok.name} label={`$${tok.name}`}>
                    <button
                      type="button"
                      className={ui.colorToken}
                      aria-label={`Token $${tok.name}`}
                      data-testid={`color-token-${tok.name}`}
                      onClick={() => {
                        commitColor(`$${tok.name}`);
                        setHsva(hsvaFromValue(doc, `$${tok.name}`, mode));
                      }}
                    >
                      <span className={ui.colorTokenSwatch} style={{ background: tok.css }} />
                      <span className="truncate">${tok.name}</span>
                    </button>
                  </Hint>
                ))}
              </div>
            </div>
          )}
          {recent.length > 0 && (
            <div className="grid gap-1.5">
              <p className="m-0 text-2xs font-semibold text-muted">{m.colorRecent}</p>
              <div className="flex flex-wrap gap-1.5" data-testid="color-recent">
                {recent.map((c) => {
                  const css = c.startsWith("$") ? String(resolveValue(doc, c, mode)) : c;
                  return (
                    <Hint key={c} label={c}>
                      <button
                        type="button"
                        className={ui.colorRecent}
                        style={{ background: browserColor(css) ? css : "#000" }}
                        aria-label={`Recente ${c}`}
                        onClick={() => {
                          commitColor(c);
                          setHsva(hsvaFromValue(doc, c, mode));
                        }}
                      />
                    </Hint>
                  );
                })}
              </div>
            </div>
          )}
          <p className="m-0 text-2xs text-muted" aria-live="polite">
            {value?.startsWith("$") ? value : resolvedPreview}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
