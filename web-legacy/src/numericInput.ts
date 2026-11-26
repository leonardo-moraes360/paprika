import { t } from "./i18n/store";
export type NumericRange = {
  min?: number;
  max?: number;
  integer?: boolean;
};

export function isNumericTyping(raw: string): boolean {
  return /^-?\d*([.,]\d*)?$/.test(raw);
}

export function allowsNumberFieldInput(raw: string, keywords?: readonly string[]): boolean {
  if (keywords?.length) {
    const lower = raw.toLowerCase();
    if (keywords.some((k) => k.startsWith(lower) || lower.startsWith(k))) return true;
  }
  return isNumericTyping(raw);
}

export function parseNumeric(raw: string): number | undefined {
  const t = raw.trim().replace(",", ".");
  if (!t || t === "-" || t === "+" || t === "." || t === "," || t === "-." || t === "-," || t === "+." || t === "+,") {
    return undefined;
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

export function rangeMessage(range: NumericRange = {}): string {
  const m = t();
  if (range.min !== undefined && range.max !== undefined) {
    return m.numericBetween(String(range.min), String(range.max));
  }
  if (range.min !== undefined) return m.numericMin(String(range.min));
  if (range.max !== undefined) return m.numericMax(String(range.max));
  return m.numericUseNumber;
}

export type NumericCommit =
  | { ok: true; value: number; text: string; clamped: boolean; message?: string }
  | { ok: false; message: string };

export function commitNumeric(raw: string, range: NumericRange = {}): NumericCommit {
  if (raw.trim() === "") return { ok: false, message: rangeMessage(range) };
  let n = parseNumeric(raw);
  if (n === undefined) return { ok: false, message: rangeMessage(range) };
  let clamped = false;
  if (range.integer) {
    const r = Math.round(n);
    if (r !== n) {
      n = r;
      clamped = true;
    }
  }
  if (range.min !== undefined && n < range.min) {
    n = range.min;
    clamped = true;
  }
  if (range.max !== undefined && n > range.max) {
    n = range.max;
    clamped = true;
  }
  const text = String(n);
  if (clamped) return { ok: true, value: n, text, clamped: true, message: rangeMessage(range) };
  return { ok: true, value: n, text, clamped: false };
}

export function defaultNumericStep(range: NumericRange = {}): number {
  if (range.min === 0 && range.max === 1) return 0.05;
  if (range.integer && range.min === 100 && range.max === 900) return 100;
  return 1;
}

export function stepAmount(range: NumericRange = {}, shift = false, step?: number): number {
  const base = step ?? defaultNumericStep(range);
  return shift ? base * 10 : base;
}

function cleanStepResult(n: number, range: NumericRange): number {
  if (range.integer) return Math.round(n);
  return Math.round(n * 1e6) / 1e6;
}

export function stepNumeric(
  current: number | undefined,
  direction: 1 | -1,
  range: NumericRange = {},
  opts: { shift?: boolean; step?: number } = {},
): NumericCommit {
  const delta = stepAmount(range, !!opts.shift, opts.step) * direction;
  const start = current ?? (range.min !== undefined ? range.min : 0);
  const next = cleanStepResult(start + delta, range);
  return commitNumeric(String(next), range);
}
