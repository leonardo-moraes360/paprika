// Tests for .github/scripts/check-actions-pinned.mjs, the guard that keeps every third-party
// GitHub Action pinned to a full commit SHA with its version in a comment.
//
// Run them with: node --test .github/scripts/test/check-actions-pinned.test.mjs
// The fixtures under ./fixtures/check-actions-pinned/ are deliberately broken; the reasons the
// checker prints are asserted one by one, and the last cases run against this repository itself.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { DEFAULT_ROOTS, checkPaths, kindOf, scanFile, violation } from "../check-actions-pinned.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const script = join(here, "..", "check-actions-pinned.mjs");
const fixtures = join(here, "fixtures", "check-actions-pinned");

const SHA = "1111111111111111111111111111111111111111";

function run(args, cwd = repoRoot) {
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    return { status: error.status, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

describe("the rules", () => {
  const acceptable = [
    [`actions/checkout@${SHA}`, "v5.0.0"],
    [`actions/checkout@${SHA}`, "5.0.0"],
    [`dtolnay/rust-toolchain@${SHA}`, "stable"],
    [`owner/action@${SHA}`, "v1.0.0 (updates the lock)"],
    [`"actions/checkout@${SHA}"`, "v5.0.0"],
    ["./.github/actions/setup-node-pnpm", null],
    ["docker://ghcr.io/org/image:1.2.3", null],
  ];
  for (const [value, comment] of acceptable) {
    it(`accepts ${value}${comment ? ` # ${comment}` : ""}`, () => {
      assert.equal(violation(value, comment), null);
    });
  }

  const rejected = [
    ["actions/checkout@v4", "v4", /not pinned to a commit SHA/],
    ["actions/checkout@main", null, /not pinned to a commit SHA/],
    ["actions/checkout@release/v4", null, /not pinned to a commit SHA/],
    [`actions/checkout@${SHA.slice(0, 10)}`, "v5.0.0", /short SHA: pin the full 40 characters/],
    [`actions/checkout@${SHA}`, null, /SHA pin without the version comment/],
    [`actions/checkout@${SHA}`, `# ${SHA}`, /unusable version comment/],
    [`actions/checkout@${SHA}`, "", /unusable version comment/],
    ["actions/checkout", null, /no commit pin/],
    ["", null, /empty uses:/],
  ];
  for (const [value, comment, expected] of rejected) {
    it(`rejects ${JSON.stringify(value)}${comment ? ` # ${comment}` : ""}`, () => {
      assert.match(violation(value, comment) ?? "", expected);
    });
  }

  it("tells local actions and containers apart from third-party ones", () => {
    assert.equal(kindOf("./x"), "local");
    assert.equal(kindOf("docker://node:20"), "container");
    assert.equal(kindOf(`actions/checkout@${SHA}`), "third-party");
  });

  it("a reference with a namespace keeps the whole name", () => {
    assert.match(violation("github/codeql-action/init@v4", "v4"), /github\/codeql-action\/init@v4/);
  });

  it("the default roots never include the fixtures", () => {
    assert.deepEqual(DEFAULT_ROOTS, [".github/workflows", ".github/actions"]);
    assert.ok(DEFAULT_ROOTS.every((root) => !root.includes("scripts")), "fixtures would fail their own scan");
  });
});

describe("scanning a file", () => {
  it("counts each kind of uses: and reports the violations with their line", () => {
    const result = scanFile(join(fixtures, "good.yml"));
    assert.deepEqual(
      { checked: result.checked, pinned: result.pinned, local: result.local, container: result.container },
      { checked: 6, pinned: 4, local: 1, container: 1 },
    );
    assert.deepEqual(result.problems, [], "a comment line mentioning uses: is not a step");
  });

  it("reads .github/actions subdirectories too", () => {
    const broken = scanFile(join(here, "..", "..", "actions", "setup-rust-wasm", "action.yml"));
    assert.deepEqual(broken.problems, []);
    assert.ok(broken.pinned >= 2, "the composite actions are part of what is checked");
  });
});

describe("the CLI", () => {
  it("passes on this repository and reports what it checked", () => {
    const { status, stdout, stderr } = run([]);
    assert.equal(status, 0, stderr);
    assert.match(stdout, /^(\d+) pinned action uses in (\d+) file\(s\) checked/, stdout);
    const pinned = Number(/(\d+) pinned action uses/.exec(stdout)[1]);
    assert.ok(pinned >= 20, `expected the whole workflow set to be pinned, got ${pinned}`);
  });

  const broken = [
    ["bad-tag.yml", /bad-tag\.yml:8: not pinned to a commit SHA \(uses: actions\/checkout@v4\)/],
    ["bad-branch.yml", /bad-branch\.yml:8: not pinned to a commit SHA \(uses: actions\/checkout@main\)/],
    ["bad-short-sha.yml", /bad-short-sha\.yml:8: short SHA: pin the full 40 characters/],
    ["bad-no-comment.yml", /bad-no-comment\.yml:8: SHA pin without the version comment/],
    ["nested/bad-deep.yml", /nested\/bad-deep\.yml:8: short SHA: pin the full 40 characters/],
  ];
  for (const [file, expected] of broken) {
    it(`names file and line for ${file}`, () => {
      const { status, stderr } = run([join(fixtures, file)]);
      assert.equal(status, 1, `${file} must fail`);
      assert.match(stderr, expected);
    });
  }

  it("fails once per violation and counts them", () => {
    const { status, stderr } = run([fixtures]);
    assert.equal(status, 1);
    assert.equal(stderr.split("\n").filter((line) => /:\d+: /.test(line)).length, 5);
    assert.match(stderr, /5 unpinned action reference\(s\) in 6 file\(s\) checked/);
  });

  it("accepts the fixture that is clean", () => {
    const { status, stdout } = run([join(fixtures, "good.yml")]);
    assert.equal(status, 0, stdout);
    assert.match(stdout, /^4 pinned action uses in 1 file\(s\) checked \(1 local action\(s\), 1 container image\(s\)/, stdout);
  });

  it("refuses a path that does not exist, with exit 2", () => {
    const { status, stderr } = run([join(fixtures, "nope.yml")]);
    assert.equal(status, 2);
    assert.match(stderr, /check-actions-pinned: no such file or directory/);
  });

  it("works from any working directory when given absolute paths", () => {
    const { status, stderr } = run([fixtures], join(repoRoot, "docs"));
    assert.equal(status, 1, stderr);
    assert.match(stderr, /bad-tag\.yml:8: /);
  });
});

describe("the repository itself", () => {
  it("has no unpinned action left", () => {
    const result = checkPaths([join(repoRoot, ".github", "workflows"), join(repoRoot, ".github", "actions")]);
    assert.deepEqual(result.problems, []);
    assert.equal(result.local > 0, true, "the composite actions are referenced locally");
  });
});
