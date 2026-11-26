import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { INFRA, PLAN_KEYS, isFullRun, planFor, planLines, planSummary } from "../ci-plan-lib.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const NOTHING = {
  full: false,
  build: false,
  ts: false,
  unit: false,
  unit_matrix: "[]",
  suites: false,
  suites_matrix: "[]",
  golden: false,
  go: false,
  rust: false,
  sync: false,
  codeql: false,
  codeql_matrix: "[]",
  docker: false,
  site: false,
};

const plan = (files) => planFor(files);

function assertEverythingOn(p, why) {
  assert.equal(p.full, true, `${why}: full`);
  for (const key of ["build", "ts", "unit", "suites", "golden", "go", "rust", "sync", "codeql", "docker", "site"]) {
    assert.equal(p[key], true, `${why}: ${key}`);
  }
  assert.deepEqual(
    JSON.parse(p.unit_matrix),
    [
      { pkg: "@paprika/core", mode: "all" },
      { pkg: "@paprika/web", mode: "all" },
    ],
    `${why}: unit_matrix`,
  );
  assert.deepEqual(
    JSON.parse(p.suites_matrix),
    [{ suite: "e2e" }, { suite: "api" }],
    `${why}: suites_matrix`,
  );
  assert.deepEqual(JSON.parse(p.codeql_matrix), ["actions", "javascript-typescript", "go", "rust"], `${why}: codeql_matrix`);
}

describe("infra files run everything", () => {
  const infraFiles = [
    ".github/workflows/ci.yml",
    ".github/scripts/ci-plan.mjs",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.base.json",
    ".npmrc",
  ];
  for (const file of infraFiles) {
    it(`${file} forces the full run`, () => {
      assert.equal(isFullRun([file]), true);
      assertEverythingOn(plan([file]), file);
    });
  }

  it("every INFRA rule has at least one fixture here", () => {
    const matched = INFRA.map((re) => infraFiles.filter((f) => re.test(f)).length);
    matched.forEach((count, i) => assert.ok(count > 0, `INFRA[${i}] (${INFRA[i]}) matches no fixture`));
  });

  it("only the workspace-root files are infra", () => {
    for (const file of ["web-legacy/package.json", "packages/core/package.json", "my-pnpm-lock.yaml", ".github/dependabot.yml", ".github/CODEOWNERS"]) {
      assert.equal(isFullRun([file]), false, file);
    }
  });

  it("one infra file in a large change forces the full run", () => {
    assertEverythingOn(plan(["docs/en-US/ci.md", "packages/core/src/ops.ts", "pnpm-lock.yaml"]), "mixed + lockfile");
  });
});

describe("ci:full and empty diffs", () => {
  it("CI_FULL=1 runs everything with no changed file", () => {
    assertEverythingOn(planFor([], { ciFull: true }), "ci:full");
  });

  it("an empty diff without CI_FULL runs nothing", () => {
    assert.deepEqual(plan([]), NOTHING);
  });

  it("a falsy ciFull does not force the full run", () => {
    assert.deepEqual(planFor(["docs/en-US/ci.md"], { ciFull: "" }), NOTHING);
    assert.deepEqual(planFor(["docs/en-US/ci.md"], { ciFull: false }), NOTHING);
  });
});

describe("docs-only changes run only Plan and CI OK", () => {
  it("a docs and README change selects no job", () => {
    assert.deepEqual(plan(["README.md", "docs/pt-BR/README.md", "docs/en-US/ci.md", "docs/pt-BR/ci.md"]), NOTHING);
  });

  it("a design or notes change selects no job", () => {
    assert.deepEqual(plan(["docs/en-US/adr/0001-go-server-sqlite.md", "AGENTS.md", "design/marca.paprika.json"]), NOTHING);
  });
});

describe("each area selects its jobs", () => {
  it("packages/core runs its unit tests, the unit tests of the app that depends on it, and both suites", () => {
    const p = plan(["packages/core/src/ops.ts", "packages/core/src/schema.ts"]);
    assert.equal(p.full, false);
    assert.equal(p.ts, true);
    assert.equal(p.build, true);
    assert.equal(p.golden, true, "the Go fixtures come from the TS core");
    assert.deepEqual(JSON.parse(p.unit_matrix), [
      { pkg: "@paprika/core", mode: "changed" },
      { pkg: "@paprika/web", mode: "all" },
    ]);
    assert.equal(p.suites, true);
    assert.deepEqual(JSON.parse(p.suites_matrix), [{ suite: "e2e" }, { suite: "api" }]);
    assert.deepEqual(JSON.parse(p.codeql_matrix), ["javascript-typescript"]);
    assert.equal(p.go, false);
    assert.equal(p.rust, false);
  });

  it("packages/e2e runs both suites but no unit test and no fixture check", () => {
    const p = plan(["packages/e2e/test/api.test.ts"]);
    assert.equal(p.unit, false);
    assert.equal(p.ts, true);
    assert.equal(p.build, true);
    assert.equal(p.golden, false);
    assert.equal(p.go, false);
    assert.deepEqual(JSON.parse(p.suites_matrix), [{ suite: "e2e" }, { suite: "api" }]);
    assert.deepEqual(JSON.parse(p.codeql_matrix), ["javascript-typescript"]);
  });

  it("the removed TypeScript server path is no longer an area", () => {
    assert.deepEqual(plan(["packages/server/src/mcp.ts"]), NOTHING);
  });

  it("web-legacy runs the e2e suite but no unit test and no API suite", () => {
    const p = plan(["web-legacy/src/Canvas.tsx"]);
    assert.equal(p.unit, false);
    assert.equal(p.unit_matrix, "[]");
    assert.deepEqual(JSON.parse(p.suites_matrix), [{ suite: "e2e" }]);
    assert.equal(p.golden, false);
    assert.equal(p.ts, true);
    assert.equal(p.build, true);
    assert.deepEqual(JSON.parse(p.codeql_matrix), ["javascript-typescript"]);
  });

  it("apps/web triggers the TS build, its own unit tests and analysis, with no e2e and no docker", () => {
    const p = plan(["apps/web/src/routes/index.tsx"]);
    assert.equal(p.ts, true);
    assert.equal(p.build, true);
    assert.equal(p.unit, true);
    assert.deepEqual(JSON.parse(p.unit_matrix), [{ pkg: "@paprika/web", mode: "all" }]);
    assert.equal(p.docker, false);
    assert.equal(p.suites, false);
    assert.deepEqual(JSON.parse(p.suites_matrix), []);
    assert.deepEqual(JSON.parse(p.codeql_matrix), ["javascript-typescript"]);
  });

  it("the e2e fixtures run the black-box suites", () => {
    const p = plan(["packages/e2e/fixtures/demo.paprika.json"]);
    assert.deepEqual(JSON.parse(p.suites_matrix), [{ suite: "e2e" }, { suite: "api" }]);
    assert.equal(p.unit, false);
    assert.equal(p.golden, false);
  });

  it("crates/render counts as web because the canvas loads its WASM build", () => {
    const p = plan(["crates/render/src/lib.rs"]);
    assert.equal(p.rust, true);
    assert.equal(p.ts, true, "the web build embeds the renderer");
    assert.deepEqual(JSON.parse(p.suites_matrix), [{ suite: "e2e" }]);
    assert.equal(p.unit, false);
    assert.deepEqual(JSON.parse(p.codeql_matrix), ["javascript-typescript", "rust"]);
  });

  it("every file the WASM parity depends on runs the e2e suite that compares DOM and WASM", () => {
    for (const file of [
      "crates/render/src/scene.rs",
      "packages/core/src/displayList.ts",
      "packages/core/src/style.ts",
      "web-legacy/src/wasmLayer.ts",
      "packages/e2e/test/e2e/wasm.e2e.test.ts",
      "packages/e2e/fixtures/wasm-path-stroke.paprika.json",
    ]) {
      const p = plan([file]);
      assert.equal(p.build, true, file);
      assert.ok(JSON.parse(p.suites_matrix).some((s) => s.suite === "e2e"), file);
    }
  });

  it("crates/sync runs the team sync job, Rust CodeQL and the image, not the canvas", () => {
    const p = plan(["crates/sync/src/node.rs"]);
    assert.equal(p.sync, true);
    assert.equal(p.rust, false, "the WASM renderer jobs stay off");
    assert.equal(p.ts, false);
    assert.equal(p.go, false);
    assert.equal(p.docker, true, "the image ships paprika-sync");
    assert.deepEqual(JSON.parse(p.codeql_matrix), ["rust"]);
  });

  it("server also runs the team sync job (internal/team runs against the sidecar)", () => {
    assert.equal(plan(["server/internal/team/team.go"]).sync, true);
  });

  it("server runs the Go jobs and never the TS-only ones", () => {
    const p = plan(["server/internal/core/ops.go"]);
    assert.equal(p.go, true);
    assert.equal(p.ts, false);
    assert.equal(p.unit, false);
    assert.equal(p.golden, true);
    assert.deepEqual(JSON.parse(p.suites_matrix), [{ suite: "e2e" }, { suite: "api" }]);
    assert.deepEqual(JSON.parse(p.codeql_matrix), ["go"]);
  });


  it("workflow and action files add the actions CodeQL language", () => {
    const p = plan([".github/actions/setup-rust-wasm/action.yml"]);
    assert.deepEqual(JSON.parse(p.codeql_matrix), ["actions"]);
    assert.equal(p.codeql, true);
    assert.equal(p.build, false);
  });

  it("a non-infra .github file is not a full run", () => {
    const p = plan([".github/dependabot.yml"]);
    assert.equal(p.full, false);
    assert.deepEqual(JSON.parse(p.codeql_matrix), ["actions"]);
    assert.equal(p.ts, false);
  });

  it("the Docker recipe builds the image and runs nothing else", () => {
    for (const file of ["Dockerfile", ".dockerignore", "compose.yaml", "compose.team.yaml"]) {
      assert.deepEqual(plan([file]), { ...NOTHING, docker: true }, file);
    }
  });

  it("everything the image packages also builds the image", () => {
    for (const file of ["packages/core/src/ops.ts", "web-legacy/src/Canvas.tsx", "crates/render/src/lib.rs", "server/internal/core/ops.go"]) {
      assert.equal(plan([file]).docker, true, file);
    }
  });

  it("what the image does not package skips the image", () => {
    for (const file of ["packages/e2e/test/api.test.ts", "packages/e2e/fixtures/demo.paprika.json", "docs/en-US/docker.md", "apps/site/scripts/build.mjs", "server.md", "nested/Dockerfile"]) {
      assert.equal(plan([file]).docker, false, file);
    }
  });

  it("the site, the brand geometry and core build the site", () => {
    for (const file of ["apps/site/src/docs.config.ts", "apps/site/design/landing.paprika.json", "scripts/brand/trio-pixel.mjs", "packages/core/src/style.ts"]) {
      assert.equal(plan([file]).site, true, file);
    }
  });

  it("what the site does not read skips the site build", () => {
    for (const file of ["web-legacy/src/Canvas.tsx", "server/internal/server/mcp.go", "crates/render/src/lib.rs", "packages/e2e/test/api.test.ts", "docs/en-US/mcp.md"]) {
      assert.equal(plan([file]).site, false, file);
    }
  });

  it("a path no area owns runs nothing", () => {
    assert.deepEqual(plan(["notes/todo.md", "design/marca.paprika.json", "tools/scratch.sh"]), NOTHING);
  });
});

describe("a mixed change unions every touched area", () => {
  it("core + server + docs keeps the full flags of both areas", () => {
    const p = plan(["packages/core/src/style.ts", "docs/en-US/adr/0002.md", "server/internal/server/routes.go"]);
    assert.equal(p.full, false);
    assert.deepEqual(JSON.parse(p.unit_matrix), [
      { pkg: "@paprika/core", mode: "changed" },
      { pkg: "@paprika/web", mode: "all" },
    ]);
    assert.equal(JSON.parse(p.suites_matrix).length, 2);
    assert.equal(p.golden, true);
    assert.equal(p.go, true);
    assert.equal(p.rust, false);
    assert.deepEqual(JSON.parse(p.codeql_matrix), ["javascript-typescript", "go"]);
  });

  it("web + server selects both stacks without being a full run", () => {
    const p = plan(["web-legacy/src/useDocument.ts", "server/go.mod"]);
    assert.equal(p.full, false);
    assert.equal(p.ts, true);
    assert.equal(p.go, true);
    assert.equal(p.unit, false);
    assert.equal(JSON.parse(p.suites_matrix).length, 2);
    assert.deepEqual(JSON.parse(p.codeql_matrix), ["javascript-typescript", "go"]);
  });

  it("deleted and renamed files still select their area", () => {
    const p = plan(["packages/core/src/old-query.ts", "web-legacy/src/Canvas.tsx"]);
    assert.equal(p.unit, true);
    assert.equal(p.ts, true);
    assert.equal(p.go, false);
  });
});

describe("the published interface", () => {
  it("every plan key is published, in order", () => {
    assert.deepEqual(Object.keys(plan(["packages/core/src/ops.ts"])), PLAN_KEYS);
  });

  it("ci.yml reads exactly the keys the plan publishes", () => {
    const yml = readFileSync(join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");
    const read = new Set([...yml.matchAll(/steps\.plan\.outputs\.([a-z_]+)/g)].map((m) => m[1]));
    assert.deepEqual([...read].sort(), [...PLAN_KEYS].sort());
  });

  it("the lines are the booleans and JSON strings GitHub expects", () => {
    const lines = planLines(plan(["docs/en-US/ci.md"]));
    assert.equal(
      lines,
      "full=false\nbuild=false\nts=false\nunit=false\nunit_matrix=[]\nsuites=false\nsuites_matrix=[]\ngolden=false\ngo=false\nrust=false\nsync=false\ncodeql=false\ncodeql_matrix=[]\ndocker=false\nsite=false\n",
    );
  });

  it("the step summary lists the plan and every changed file", () => {
    const summary = planSummary(plan(["docs/en-US/ci.md", "README.md"]), ["docs/en-US/ci.md", "README.md"]);
    assert.match(summary, /^### CI plan\n\n\| output \| value \|\n\| --- \| --- \|\n/);
    assert.match(summary, /\| `full` \| `false` \|/);
    assert.match(summary, /<details><summary>2 changed files<\/summary>/);
    assert.ok(summary.includes("- `docs/en-US/ci.md`"));
    assert.ok(planSummary(plan([]), []).includes("_none_"));
  });
});

describe("the CLI wrapper", () => {
  const script = join(repoRoot, ".github", "scripts", "ci-plan.mjs");

  const run = (args, env) =>
    execFileSync(process.execPath, [script, ...args], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, GITHUB_OUTPUT: "", GITHUB_STEP_SUMMARY: "", CI_FULL: "", ...env },
    });

  it("prints usage and exits 2 without a base ref", () => {
    assert.throws(
      () => run([], {}),
      (err) => {
        assert.equal(err.status, 2);
        assert.match(err.stderr, /usage: ci-plan\.mjs <base-sha> \[head-ref\]/);
        return true;
      },
    );
  });

  it("reports a missing git instead of spawning one from PATH", () => {
    assert.throws(
      () => run(["HEAD", "HEAD"], { PATH: "" }),
      (err) => {
        assert.equal(err.status, 3);
        assert.match(err.stderr, /ci-plan: git not found on PATH/);
        return true;
      },
    );
  });

  it("writes the plan to stdout when GITHUB_OUTPUT is unset", () => {
    assert.equal(run(["HEAD", "HEAD"], {}), planLines(plan([])));
  });

  it("appends the plan to GITHUB_OUTPUT and the summary to GITHUB_STEP_SUMMARY", () => {
    const dir = mkdtempSync(join(tmpdir(), "ci-plan-test-"));
    try {
      const out = join(dir, "output");
      const summary = join(dir, "summary");
      assert.equal(run(["HEAD", "HEAD"], { GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: summary }), "");
      assert.equal(readFileSync(out, "utf8"), planLines(plan([])));
      assert.match(readFileSync(summary, "utf8"), /^### CI plan\n/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads CI_FULL from the environment", () => {
    assert.equal(run(["HEAD", "HEAD"], { CI_FULL: "1" }), planLines(planFor([], { ciFull: true })));
    assert.equal(run(["HEAD", "HEAD"], { CI_FULL: "0" }), planLines(plan([])));
  });
});
