export const INFRA = [
  /^\.github\/(workflows|scripts)\//,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/,
  /^tsconfig\.base\.json$/,
  /^\.npmrc$/,
];

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
  "site",
];

export function isFullRun(files, ciFull = false) {
  return ciFull || files.some((f) => INFRA.some((re) => re.test(f)));
}

export function planFor(files, { ciFull = false } = {}) {
  const touched = (re) => files.some((f) => re.test(f));
  const full = isFullRun(files, ciFull);
  const area = (re) => full || touched(re);

  const core = area(/^packages\/core\//);
  const e2e = area(/^packages\/e2e\//);
  const rust = area(/^crates\/render\//);
  const web = area(/^(apps\/web|web-legacy)\//) || rust;
  const go = area(/^server\//);
  const sync = area(/^crates\/sync\//) || go;
  const actions = area(/^\.github\//);
  const dockerfiles = area(/^(Dockerfile|\.dockerignore|compose(\.team)?\.yaml)$/);

  const unit = [];
  if (core) unit.push({ pkg: "@paprika/core", mode: full ? "all" : "changed" });

  const suites = [];
  if (core || e2e || web || go) suites.push({ suite: "e2e" });
  if (core || e2e || go) suites.push({ suite: "api" });

  const ts = core || e2e || web;
  const golden = core || go;
  const build = ts || go || unit.length > 0 || suites.length > 0;

  const codeql = [];
  if (actions) codeql.push("actions");
  if (ts) codeql.push("javascript-typescript");
  if (go) codeql.push("go");
  if (rust || area(/^crates\/sync\//)) codeql.push("rust");

  const site = core || area(/^(apps\/site|scripts\/brand)\//);

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
    site,
  };
}

export function planLines(plan) {
  return Object.entries(plan)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n")
    .concat("\n");
}

export function planSummary(plan, files) {
  const rows = Object.entries(plan).map(([k, v]) => `| \`${k}\` | \`${v}\` |`).join("\n");
  const list = files.length ? files.map((f) => `- \`${f}\``).join("\n") : "_none_";
  return `### CI plan\n\n| output | value |\n| --- | --- |\n${rows}\n\n<details><summary>${files.length} changed files</summary>\n\n${list}\n</details>\n`;
}
