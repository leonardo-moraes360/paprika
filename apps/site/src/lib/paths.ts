import { posix } from "node:path";

export const REPO = "https://github.com/leonardo-moraes360/paprika";

export const pretty = (p: string) => p.replace(/(^|\/)index\.html$/, "$1");

export function rel(fromPage: string, toPath: string): string {
  const r = posix.relative(posix.dirname(fromPage), toPath);
  if (r === "") return "./";
  return toPath.endsWith("/") && !r.endsWith("/") ? `${r}/` : r;
}

export const href = (fromPage: string, toPage: string) => rel(fromPage, pretty(toPage) || "./");
