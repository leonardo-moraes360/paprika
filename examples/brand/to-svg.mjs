// Converts a Paprika frame made of rect/ellipse children (absolute layout) into a standalone SVG.
// Usage: node examples/brand/to-svg.mjs <file.paprika.json> <frameId|frameName> [size] > icon.svg
import { readFileSync } from "node:fs";

const [file, target, sizeArg] = process.argv.slice(2);
const doc = JSON.parse(readFileSync(file, "utf8"));
const frame = doc.nodes[target] ?? Object.values(doc.nodes).find((n) => n.name === target || n.id === target);
if (!frame || frame.type !== "frame") throw new Error(`frame "${target}" not found`);

const resolve = (v) => {
  for (let i = 0; i < 8 && typeof v === "string" && v.startsWith("$"); i++) v = doc.tokens[v.slice(1)] ?? v;
  return v;
};
const r2 = (n) => Math.round(n * 100) / 100;
const paint = (n) => {
  const fill = n.fill ? resolve(n.fill) : "none";
  const stroke = n.stroke ? ` stroke="${resolve(n.stroke.color)}" stroke-width="${n.stroke.width}"` : "";
  const opacity = n.opacity !== undefined && n.opacity !== 1 ? ` opacity="${n.opacity}"` : "";
  return ` fill="${fill === "transparent" ? "none" : fill}"${stroke}${opacity}`;
};
const rot = (n) => (n.rotation ? ` transform="rotate(${n.rotation} ${r2(n.x + n.width / 2)} ${r2(n.y + n.height / 2)})"` : "");

const W = frame.width;
const H = frame.height;
const out = [`<rect width="${W}" height="${H}" rx="${frame.radius ?? 0}"${paint(frame)}/>`];
for (const id of frame.children) {
  const n = doc.nodes[id];
  if (!n || !n.visible) continue;
  if (n.type === "ellipse")
    out.push(`<ellipse cx="${r2(n.x + n.width / 2)}" cy="${r2(n.y + n.height / 2)}" rx="${r2(n.width / 2)}" ry="${r2(n.height / 2)}"${paint(n)}${rot(n)}/>`);
  else if (n.type === "rect")
    out.push(`<rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="${n.radius ?? 0}"${paint(n)}${rot(n)}/>`);
  else throw new Error(`unsupported node type in icon: ${n.type}`);
}
const size = Number(sizeArg ?? W);
process.stdout.write(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${r2((size * H) / W)}" viewBox="0 0 ${W} ${H}">` +
    `<defs><clipPath id="clip-${frame.id}"><rect width="${W}" height="${H}" rx="${frame.radius ?? 0}"/></clipPath></defs><g clip-path="url(#clip-${frame.id})">` +
    out.join("") + `</g></svg>\n`,
);
