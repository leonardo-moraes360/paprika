import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../lib/markdown";

export function GET() {
  return new Response(readFileSync(join(ROOT, "docs/en-US/brand/favicon.svg")), { headers: { "content-type": "image/svg+xml" } });
}
