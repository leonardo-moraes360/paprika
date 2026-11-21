#!/usr/bin/env node
// Decides which CI jobs a pull request needs, from the files it changes.
//
// Usage: node .github/scripts/ci-plan.mjs <base-sha> [head-ref]
//   CI_FULL=1  forces every job (set by the `ci:full` label).
//
// Writes `key=value` lines to $GITHUB_OUTPUT (or stdout when run locally) and a summary table to
// $GITHUB_STEP_SUMMARY. Run it locally to see what CI would do for your branch:
//   node .github/scripts/ci-plan.mjs origin/main HEAD
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const [base, head = "HEAD"] = process.argv.slice(2);
if (!base) {
  console.error("usage: ci-plan.mjs <base-sha> [head-ref]");
  process.exit(2);
}

const files = execFileSync("git", ["diff", "--name-only", base, head], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

// Files that can change how everything builds or runs: any change here runs the whole CI.
const INFRA = [
  /^\.github\/(workflows|scripts)\//,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/,
  /^tsconfig\.base\.json$/,
  /^\.npmrc$/,
];

const touched = (re) => files.some((f) => re.test(f));
const full = process.env.CI_FULL === "1" || files.some((f) => INFRA.some((re) => re.test(f)));
const area = (re) => full || touched(re);

const core = area(/^packages\/core\//);
const server = area(/^packages\/server\//);
const web = area(/^apps\/web\//);
const examples = area(/^examples\//);
const go = area(/^server-go\//);
const rust = area(/^experiments\/canvas-wasm\/(src\/|Cargo\.(toml|lock)$|build\.sh$)/);
const benchTs = area(/^experiments\/canvas-wasm\/bench\//);
const actions = area(/^\.github\//);

// Unit tests per workspace package. A package runs every test when one of its dependencies
// changed (vitest cannot see through the built `dist/` of a workspace dependency); when only the
// package itself changed, `vitest --changed` runs just the tests whose import graph was touched.
const unit = [];
if (core) unit.push({ pkg: "@paprika/core", mode: full ? "all" : "changed" });
if (core || server) unit.push({ pkg: "@paprika/server", mode: full || core ? "all" : "changed" });

// Black-box suites, each against both server implementations.
const suites = [];
if (core || server || web || examples) suites.push({ suite: "e2e", impl: "ts" });
if (core || server || web || examples || go) suites.push({ suite: "e2e", impl: "go" });
if (core || server) suites.push({ suite: "parity", impl: "ts" });
if (core || server || go) suites.push({ suite: "parity", impl: "go" });

const ts = core || server || web || examples;
const golden = core || server || go; // Go fixtures are generated from the TS core and MCP tools.
const build = ts || go || unit.length > 0 || suites.length > 0;

const codeql = [];
if (actions) codeql.push("actions");
if (ts || benchTs) codeql.push("javascript-typescript");
if (go) codeql.push("go");
if (rust) codeql.push("rust");

const plan = {
  full,
  build,
  ts,
  unit: unit.length > 0,
  unit_matrix: JSON.stringify(unit),
  suites: suites.length > 0,
  suites_matrix: JSON.stringify(suites),
  golden,
  go,
  rust,
  codeql: codeql.length > 0,
  codeql_matrix: JSON.stringify(codeql),
};

const lines = Object.entries(plan).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines);
else process.stdout.write(lines);

if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = Object.entries(plan).map(([k, v]) => `| \`${k}\` | \`${v}\` |`).join("\n");
  const list = files.length ? files.map((f) => `- \`${f}\``).join("\n") : "_none_";
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### CI plan\n\n| output | value |\n| --- | --- |\n${rows}\n\n<details><summary>${files.length} changed files</summary>\n\n${list}\n</details>\n`,
  );
}
