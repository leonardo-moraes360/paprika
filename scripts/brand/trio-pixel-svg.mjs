import { copyFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LOCKUP_GAP, THEMES, symbolLayers, wordmark } from "./trio-pixel.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const r2 = (n) => Math.round(n * 100) / 100;

const layerSvg = (l) =>
  `<path d="${l.d}" fill="${l.fill ?? "none"}"${l.stroke ? ` stroke="${l.stroke}" stroke-width="${l.sw}" stroke-linejoin="round"` : ""}/>`;

function icon(c, { selection = true } = {}) {
  const s = 184 / 100;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 240 240">`,
    `<rect x="0.5" y="0.5" width="239" height="239" rx="56" fill="${c.tile}" stroke="${c.tileStroke}"/>`,
    `<g transform="translate(28 28) scale(${s})">${symbolLayers(c, { selection }).map(layerSvg).join("")}</g>`,
    `</svg>\n`,
  ].join("");
}

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

function lockupSvg(c) {
  const wm = wordmark();
  const [vx, vy, vw, vh] = wm.viewBox;
  const wmH = 96, wmW = (vw / vh) * wmH, k = wmH / vh;
  const symbol = 128, gapX = (LOCKUP_GAP * symbol) / 100;
  const wmY = r2(symbol / 2 - (50 - vy) * k);
  const W = r2(symbol + gapX + wmW), H = symbol;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<g transform="scale(${symbol / 100})">${symbolLayers(c).map(layerSvg).join("")}</g>`,
    `<g transform="translate(${r2(symbol + gapX - vx * k)} ${r2(wmY - vy * k)}) scale(${r2(k * 1e4) / 1e4})">`,
    `<path d="${wm.stroke}" fill="none" stroke="${c.ink}" stroke-width="${wm.sw}" stroke-linecap="round" stroke-linejoin="round"/>`,
    `<path d="${wm.dot}" fill="${c.amarelo}"/></g>`,
    `</svg>\n`,
  ].join("");
}

const out = (name, svg) => writeFileSync(`${root}docs/en-US/brand/${name}`, svg);
out("icon.svg", icon(THEMES.dark));
out("icon-light.svg", icon(THEMES.light));
out("wordmark.svg", wordmarkSvg(THEMES.dark));
out("wordmark-light.svg", wordmarkSvg(THEMES.light));
out("lockup.svg", lockupSvg(THEMES.dark));
out("lockup-light.svg", lockupSvg(THEMES.light));
out("favicon.svg", icon(THEMES.dark, { selection: false }));
copyFileSync(`${root}docs/en-US/brand/favicon.svg`, `${root}apps/web/public/icon.svg`);
console.log("docs/en-US/brand: icon, icon-light, wordmark, wordmark-light, lockup, lockup-light, favicon; apps/web/public/icon.svg");
