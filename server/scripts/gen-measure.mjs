#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const { MEASURE_SCRIPT } = await import(pathToFileURL(join(root, "packages/core/dist/index.js")).href);
writeFileSync(join(here, "../contract/measure.js"), MEASURE_SCRIPT + "\n");
console.log("measure script → server/contract/measure.js");
