/// <reference types="astro/client" />
declare module "*/trio-pixel.mjs" {
  export const THEMES: Record<string, Record<string, string>>;
  export function symbolLayers(c: Record<string, string>, opts?: { selection?: boolean }): unknown[];
}
