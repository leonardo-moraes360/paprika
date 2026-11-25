export function round4(v: number): number {
  return Math.round(v * 10_000) / 10_000 + 0;
}
