// Brand assets from the repository (docs/en-US/brand and scripts/brand/trio-pixel.mjs).
import { THEMES, symbolLayers } from "../../../../scripts/brand/trio-pixel.mjs";
export { default as lockupDark } from "../../../../docs/en-US/brand/lockup.svg?url";
export { default as lockupLight } from "../../../../docs/en-US/brand/lockup-light.svg?url";
export { default as favicon } from "../../../../docs/en-US/brand/favicon.svg?url";

type Layer = { d: string; fill?: string; stroke?: string; sw?: number };
const layer = (l: Layer) =>
  `<path d="${l.d}" fill="${l.fill ?? "none"}"${l.stroke ? ` stroke="${l.stroke}" stroke-width="${l.sw}" stroke-linejoin="round"` : ""}/>`;
const symbol = (c: Record<string, string>) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" aria-hidden="true">${(symbolLayers(c, { selection: true }) as Layer[]).map(layer).join("")}</svg>`;

const MONO = { ...THEMES.dark, vermelho: "#3A4263", amarelo: "#3A4263", verde: "#3A4263", verdeEscuro: "#3A4263", brilho: "#4A5378", selecao: "#4A5378", alca: "#141827" };

export const symbolColor = symbol(THEMES.dark);
export const symbolMono = symbol(MONO);
