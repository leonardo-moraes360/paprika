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
  if (range.min !== undefined && range.max !== undefined) {
    return `Use um número entre ${range.min} e ${range.max}.`;
  }
  if (range.min !== undefined) return `Use um número ≥ ${range.min}.`;
  if (range.max !== undefined) return `Use um número ≤ ${range.max}.`;
  return "Use um número.";
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
