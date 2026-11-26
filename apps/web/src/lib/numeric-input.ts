export type NumericRange = {
  min?: number;
  max?: number;
  integer?: boolean;
};

export type NumericIssue = { kind: "number" } | { kind: "min"; min: number } | { kind: "max"; max: number } | { kind: "between"; min: number; max: number };

export function isNumericTyping(raw: string): boolean {
  return /^-?\d*([.,]\d*)?$/.test(raw);
}

export function allowsNumberFieldInput(raw: string, keywords?: readonly string[]): boolean {
  if (keywords?.length) {
    const lower = raw.toLowerCase();
    if (keywords.some((keyword) => keyword.startsWith(lower) || lower.startsWith(keyword))) return true;
  }
  return isNumericTyping(raw);
}

export function parseNumeric(raw: string): number | undefined {
  const text = raw.trim().replace(",", ".");
  if (!text || /^[-+]?\.?$/.test(text)) return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

export function rangeIssue(range: NumericRange = {}): NumericIssue {
  if (range.min !== undefined && range.max !== undefined) return { kind: "between", min: range.min, max: range.max };
  if (range.min !== undefined) return { kind: "min", min: range.min };
  if (range.max !== undefined) return { kind: "max", max: range.max };
  return { kind: "number" };
}

export type NumericCommit =
  | { ok: true; value: number; text: string; clamped: boolean; issue?: NumericIssue }
  | { ok: false; issue: NumericIssue };

export function commitNumeric(raw: string, range: NumericRange = {}): NumericCommit {
  let value = parseNumeric(raw);
  if (value === undefined) return { ok: false, issue: rangeIssue(range) };
  let clamped = false;
  if (range.integer) {
    const rounded = Math.round(value);
    if (rounded !== value) {
      value = rounded;
      clamped = true;
    }
  }
  if (range.min !== undefined && value < range.min) {
    value = range.min;
    clamped = true;
  }
  if (range.max !== undefined && value > range.max) {
    value = range.max;
    clamped = true;
  }
  return clamped ? { ok: true, value, text: String(value), clamped, issue: rangeIssue(range) } : { ok: true, value, text: String(value), clamped };
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

export function stepNumeric(current: number | undefined, direction: 1 | -1, range: NumericRange = {}, options: { shift?: boolean; step?: number } = {}): NumericCommit {
  const delta = stepAmount(range, options.shift ?? false, options.step) * direction;
  const start = current ?? range.min ?? 0;
  const next = range.integer ? Math.round(start + delta) : Math.round((start + delta) * 1e6) / 1e6;
  return commitNumeric(String(next), range);
}

export type SizeSide = "width" | "height";

export function lockedSize(changed: SizeSide, value: number, current: { width: number; height: number }): { width: number; height: number } | null {
  const own = current[changed];
  const other = changed === "width" ? current.height : current.width;
  if (!(own > 0) || !(other > 0) || !(value > 0)) return null;
  const follower = Math.round(((value * other) / own) * 1e4) / 1e4;
  return changed === "width" ? { width: value, height: follower } : { width: follower, height: value };
}

export type PaddingValue = number | string;

export function parsePadding(raw: string): PaddingValue | [PaddingValue, PaddingValue, PaddingValue, PaddingValue] | null {
  const parts = raw
    .trim()
    .split(/[\s,]+/)
    .map((part): PaddingValue | undefined => {
      if (/^\$[\w.-]+$/.test(part)) return part;
      const value = parseNumeric(part);
      return value === undefined || value < 0 ? undefined : value;
    });
  if (parts.some((part) => part === undefined)) return null;
  if (parts.length === 1) return parts[0] as PaddingValue;
  if (parts.length === 4) return parts as [PaddingValue, PaddingValue, PaddingValue, PaddingValue];
  return null;
}

export function formatPadding(padding: PaddingValue | readonly PaddingValue[] | undefined): string {
  if (padding === undefined) return "";
  return typeof padding === "object" ? padding.join(" ") : String(padding);
}
