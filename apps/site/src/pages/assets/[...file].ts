import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { ENTRIES, type Lang } from "../../docs.config";
import { ROOT, assetFiles, renderDoc } from "../../lib/markdown";

const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp" };

export function getStaticPaths() {
  for (const e of ENTRIES) for (const lang of ["en", "pt-BR"] as Lang[]) if (e.src[lang]) renderDoc(e.src[lang], e.out[lang], lang);
  return assetFiles().map((file) => ({ params: { file } }));
}

export function GET({ params }: { params: { file: string } }) {
  return new Response(readFileSync(join(ROOT, params.file)), { headers: { "content-type": TYPES[extname(params.file).toLowerCase()] ?? "application/octet-stream" } });
}
