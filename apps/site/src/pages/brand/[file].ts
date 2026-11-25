import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../../lib/markdown";

const FILES = ["lockup.svg", "lockup-light.svg", "favicon.svg", "icon.svg"];

export function getStaticPaths() {
  return FILES.map((file) => ({ params: { file } }));
}

export function GET({ params }: { params: { file: string } }) {
  return new Response(readFileSync(join(ROOT, "docs/en-US/brand", params.file)), { headers: { "content-type": "image/svg+xml" } });
}
