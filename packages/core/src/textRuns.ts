import type { TextRun } from "./schema.js";

export interface TextPiece {
  text: string;
  run?: TextRun;
}

export function textPieces(text: string, runs: readonly TextRun[] | undefined): TextPiece[] {
  if (!runs?.length) return [{ text }];
  const out: TextPiece[] = [];
  let i = 0;
  for (const run of runs) {
    if (run.start > i) out.push({ text: text.slice(i, run.start) });
    if (run.end > run.start) out.push({ text: text.slice(Math.max(i, run.start), run.end), run });
    i = Math.max(i, run.end);
  }
  if (i < text.length) out.push({ text: text.slice(i) });
  return out.filter((p) => p.text.length > 0);
}

export function piecesInRange(text: string, absStart: number, runs: readonly TextRun[] | undefined): TextPiece[] {
  if (!runs?.length) return text.length ? [{ text }] : [];
  const local: TextRun[] = [];
  for (const run of runs) {
    const start = run.start - absStart;
    const end = run.end - absStart;
    if (end <= 0 || start >= text.length) continue;
    local.push({ ...run, start: Math.max(0, start), end: Math.min(text.length, end) });
  }
  return textPieces(text, local);
}
