/** Arredonda a 4 casas (e troca -0 por 0) para coordenadas calculadas: estável entre TS e Go. */
export function round4(v: number): number {
  return Math.round(v * 10_000) / 10_000 + 0;
}
