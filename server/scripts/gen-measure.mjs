#!/usr/bin/env node
// Copies the SVG export's measure script from @paprika/core to server/contract/measure.js, so
// the Go server measures boxes and text lines exactly like the TypeScript core.
// Usage (repo root, after `pnpm build`):
//   node server/scripts/gen-measure.mjs
//
// The rest of server/contract (mcp.json: tool definitions, instructions and server info;
// guide.pt-BR.md) is the MCP contract itself, edited by hand: the Go server serves it verbatim and
// the black-box suite in packages/e2e checks it.
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const { MEASURE_SCRIPT } = await import(pathToFileURL(join(root, "packages/core/dist/index.js")).href);
writeFileSync(join(here, "../contract/measure.js"), MEASURE_SCRIPT + "\n");
console.log("measure script → server/contract/measure.js");
