// Writes the Trio Pixel brand SVGs into docs/brand/ (and the app favicon).
// Usage: node scripts/brand/trio-pixel-svg.mjs
import { copyFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { THEMES, symbolLayers, wordmark } from "./trio-pixel.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const r2 = (n) => Math.round(n * 100) / 100;

const layerSvg = (l) =>
  `<path d="${l.d}" fill="${l.fill ?? "none"}"${l.stroke ? ` stroke="${l.stroke}" stroke-width="${l.sw}" stroke-linejoin="round"` : ""}/>`;

/** App icon: rounded tile (240, rx 56) with the symbol at 184px. */
function icon(c, { selection = true } = {}) {
  const s = 184 / 100;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 240 240">`,
    `<rect x="0.5" y="0.5" width="239" height="239" rx="56" fill="${c.tile}" stroke="${c.tileStroke}"/>`,
    `<g transform="translate(28 28) scale(${s})">${symbolLayers(c, { selection }).map(layerSvg).join("")}</g>`,
    `</svg>\n`,
  ].join("");
}

/** Wordmark alone, in the theme's ink. */
function wordmarkSvg(c, height = 96) {
  const wm = wordmark();
  const [vx, vy, vw, vh] = wm.viewBox;
  const w = r2((vw / vh) * height);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${height}" viewBox="${vx} ${vy} ${r2(vw)} ${vh}">`,
    `<path d="${wm.stroke}" fill="none" stroke="${c.ink}" stroke-width="${wm.sw}" stroke-linecap="round" stroke-linejoin="round"/>`,
    `<path d="${wm.dot}" fill="${c.amarelo}"/>`,
    `</svg>\n`,
  ].join("");
}

/** Lockup: symbol (no tile) + wordmark, as in the boards (symbol 128, wordmark 96 high). */
function lockupSvg(c) {
  const wm = wordmark();
  const [vx, vy, vw, vh] = wm.viewBox;
  const wmH = 96, wmW = (vw / vh) * wmH, k = wmH / vh;
  const symbol = 128, gapX = 6, wmY = 22;
  // the selection frame reaches y≈104 of the 100 box: leave room for it
  const W = r2(symbol + gapX + wmW), H = r2(symbol * 1.08);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<g transform="scale(${symbol / 100})">${symbolLayers(c).map(layerSvg).join("")}</g>`,
    `<g transform="translate(${r2(symbol + gapX - vx * k)} ${r2(wmY - vy * k)}) scale(${r2(k * 1e4) / 1e4})">`,
    `<path d="${wm.stroke}" fill="none" stroke="${c.ink}" stroke-width="${wm.sw}" stroke-linecap="round" stroke-linejoin="round"/>`,
    `<path d="${wm.dot}" fill="${c.amarelo}"/></g>`,
    `</svg>\n`,
  ].join("");
}

const out = (name, svg) => writeFileSync(`${root}docs/brand/${name}`, svg);
out("icon.svg", icon(THEMES.dark));
out("icon-light.svg", icon(THEMES.light));
out("wordmark.svg", wordmarkSvg(THEMES.dark));
out("wordmark-light.svg", wordmarkSvg(THEMES.light));
out("lockup.svg", lockupSvg(THEMES.dark));
out("lockup-light.svg", lockupSvg(THEMES.light));
// Small sizes (favicon, 22px header logo): no selection frame, which turns to noise under 32px.
out("favicon.svg", icon(THEMES.dark, { selection: false }));
copyFileSync(`${root}docs/brand/favicon.svg`, `${root}apps/web/public/icon.svg`);
console.log("docs/brand: icon, icon-light, wordmark, wordmark-light, lockup, lockup-light, favicon; apps/web/public/icon.svg");
