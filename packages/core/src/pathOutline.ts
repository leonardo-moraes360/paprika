export function formatSvgNumber(n: number): string {
  const v = Math.round(n * 100) / 100;
  return Object.is(v, -0) ? "0" : String(v);
}

export function roundedRectD(x: number, y: number, w: number, h: number, radii: [number, number, number, number]): string {
  const f = formatSvgNumber;
  const [tl, tr, br, bl] = radii;
  const parts = [`M${f(x + tl)} ${f(y)}`, `L${f(x + w - tr)} ${f(y)}`];
  if (tr) parts.push(`A${f(tr)} ${f(tr)} 0 0 1 ${f(x + w)} ${f(y + tr)}`);
  parts.push(`L${f(x + w)} ${f(y + h - br)}`);
  if (br) parts.push(`A${f(br)} ${f(br)} 0 0 1 ${f(x + w - br)} ${f(y + h)}`);
  parts.push(`L${f(x + bl)} ${f(y + h)}`);
  if (bl) parts.push(`A${f(bl)} ${f(bl)} 0 0 1 ${f(x)} ${f(y + h - bl)}`);
  parts.push(`L${f(x)} ${f(y + tl)}`);
  if (tl) parts.push(`A${f(tl)} ${f(tl)} 0 0 1 ${f(x + tl)} ${f(y)}`);
  parts.push("Z");
  return parts.join(" ");
}
