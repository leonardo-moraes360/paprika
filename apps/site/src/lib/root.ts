import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

function findRoot(): string {
  let dir = process.cwd();
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const up = dirname(dir);
    if (up === dir) throw new Error("repository root not found from " + process.cwd());
    dir = up;
  }
  return dir;
}

export const ROOT = findRoot();
export const SITE = join(ROOT, "apps/site");
