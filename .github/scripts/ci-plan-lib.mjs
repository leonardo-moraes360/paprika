// The decision half of the CI plan: changed files in, job selection out.
//
// This module is pure — no git, no `process.env`, no file system — so
// `.github/scripts/test/ci-plan.test.mjs` can describe every rule it encodes.
// `ci-plan.mjs` is the thin CLI around it (git diff, `$GITHUB_OUTPUT`, `$GITHUB_STEP_SUMMARY`).
// The rules themselves are documented in docs/ci.md; change both together.

// Files that can change how everything builds or runs: any change here runs the whole CI.
export const INFRA = [
  /^\.github\/(workflows|scripts)\//,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/,
  /^tsconfig\.base\.json$/,
  /^\.npmrc$/,
];

// The `key=value` outputs, in the order the `plan` job of ci.yml declares them.
export const PLAN_KEYS = [
  "full",
  "build",
  "ts",
  "unit",
  "unit_matrix",
  "suites",
  "suites_matrix",
  "golden",
  "go",
  "rust",
  "sync",
  "codeql",
  "codeql_matrix",
  "docker",
];

/**
 * Whether this change runs every job: the `ci:full` label or any infra file.
 *
 * @param {string[]} files paths as `git diff --name-only` prints them.
 * @param {boolean} [ciFull] set when the PR carries the `ci:full` label.
 * @returns {boolean}
 */
export function isFullRun(files, ciFull = false) {
  return ciFull || files.some((f) => INFRA.some((re) => re.test(f)));
}

/**
 * Decide which CI jobs a change needs.
 *
 * @param {string[]} files paths as `git diff --name-only` prints them.
 * @param {{ ciFull?: boolean }} [options] `ci:full` label state.
 * @returns {Record<string, boolean | string>} every key of `PLAN_KEYS`; the matrices are JSON
 *   strings so they can go straight into `GITHUB_OUTPUT`.
 */
export function planFor(files, { ciFull = false } = {}) {
  const touched = (re) => files.some((f) => re.test(f));
  const full = isFullRun(files, ciFull);
  const area = (re) => full || touched(re);

  const core = area(/^packages\/core\//);
  // The black-box suites (MCP, HTTP/WS API and canvas E2E) that run against the Go server.
  const e2e = area(/^packages\/e2e\//);
  // crates/render is built into apps/web (the canvas's WASM mode), so it also counts as web.
  const rust = area(/^crates\/render\//);
  const web = area(/^apps\/web\//) || rust;
  const go = area(/^server\//);
  // The team sync sidecar (crates/sync) and the Go package that drives it: built and tested
  // together, since server/internal/team runs against the real binary.
  const sync = area(/^crates\/sync\//) || go;
  const actions = area(/^\.github\//);
  // The image's own files. Everything else that goes into the image (core, web, crates/render,
  // crates/sync, server) is one of the areas above.
  const dockerfiles = area(/^(Dockerfile|\.dockerignore|compose(\.team)?\.yaml)$/);

  // Unit tests per workspace package. A package runs every test when one of its dependencies
  // changed (vitest cannot see through the built `dist/` of a workspace dependency); when only the
  // package itself changed, `vitest --changed` runs just the tests whose import graph was touched.
  const unit = [];
  if (core) unit.push({ pkg: "@paprika/core", mode: full ? "all" : "changed" });

  // Black-box suites of packages/e2e, against the Go server binary. The canvas E2E needs the web
  // build and the fixtures in packages/e2e; the API suite only talks MCP, HTTP and WebSocket.
  const suites = [];
  if (core || e2e || web || go) suites.push({ suite: "e2e" });
  if (core || e2e || go) suites.push({ suite: "api" });

  const ts = core || e2e || web;
  const golden = core || go; // Go fixtures are generated from the TS core.
  const build = ts || go || unit.length > 0 || suites.length > 0;

  const codeql = [];
  if (actions) codeql.push("actions");
  if (ts) codeql.push("javascript-typescript");
  if (go) codeql.push("go");
  if (rust || area(/^crates\/sync\//)) codeql.push("rust");

  // Build the Docker image and smoke-test it when its recipe or anything it packages changed.
  const docker = dockerfiles || core || web || go || area(/^crates\/sync\//);

  return {
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
    sync,
    codeql: codeql.length > 0,
    codeql_matrix: JSON.stringify(codeql),
    docker,
  };
}

/**
 * Render a plan as the `key=value` lines a `GITHUB_OUTPUT` file expects.
 *
 * @param {Record<string, boolean | string>} plan result of `planFor`.
 * @returns {string}
 */
export function planLines(plan) {
  return Object.entries(plan)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n")
    .concat("\n");
}

/**
 * Render a plan plus the files behind it as the markdown block a `GITHUB_STEP_SUMMARY` expects.
 *
 * @param {Record<string, boolean | string>} plan result of `planFor`.
 * @param {string[]} files the changed files the plan was computed from.
 * @returns {string}
 */
export function planSummary(plan, files) {
  const rows = Object.entries(plan).map(([k, v]) => `| \`${k}\` | \`${v}\` |`).join("\n");
  const list = files.length ? files.map((f) => `- \`${f}\``).join("\n") : "_none_";
  return `### CI plan\n\n| output | value |\n| --- | --- |\n${rows}\n\n<details><summary>${files.length} changed files</summary>\n\n${list}\n</details>\n`;
}
