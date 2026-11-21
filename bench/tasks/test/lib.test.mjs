// Tests for the path guard in bench/tasks/lib.mjs (Sonar S8707).
//
// Run them with: node --test bench/tasks/test/*.test.mjs
// The checkers are invoked with a document path from the command line, so that path is untrusted
// input: it must not be able to read outside the directory the run started in.
import assert from "node:assert/strict";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { Report, insideCwd, loadDocument } from "../lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");

describe("insideCwd", () => {
  it("accepts a relative path under the current directory", () => {
    process.chdir(repoRoot);
    const document = join("bench", "fixtures", "login-card-reference", "document.paprika.json");
    assert.equal(insideCwd(document), resolve(repoRoot, document));
    assert.equal(insideCwd(resolve(repoRoot, document)), resolve(repoRoot, document), "absolute inside cwd is fine");
    assert.equal(insideCwd(join("bench", "fixtures", "..", "tasks", "lib.mjs")), resolve(repoRoot, "bench/tasks/lib.mjs"), ".. segments that stay inside are fine");
  });

  it("refuses to leave the current directory", () => {
    process.chdir(repoRoot);
    for (const path of ["../../etc/passwd", "..", resolve(repoRoot, "..", "..", "etc", "passwd"), "/", sep]) {
      assert.equal(insideCwd(path), null, path);
    }
    assert.equal(insideCwd(join("bench", "..", "..", "package.json")), null, "walks out through the middle");
  });

  it("the current directory itself is not a document", () => {
    process.chdir(repoRoot);
    assert.equal(insideCwd("."), null);
    assert.equal(insideCwd(repoRoot), null);
  });
});

describe("loadDocument", () => {
  it("refuses an escaping path before touching the file system", () => {
    process.chdir(repoRoot);
    const report = new Report("guard");
    for (const path of ["../../etc/passwd", "/etc/passwd"]) {
      assert.equal(loadDocument(path, report), null, path);
    }
    const messages = report.results.map((r) => r.name);
    assert.equal(messages.length, 2);
    assert.ok(messages.every((m) => m.includes("must be inside the current directory")), messages.join(" | "));
    assert.ok(!messages.some((m) => m.startsWith("cannot read")), "the escape never reached readFileSync");
  });

  it("loads a document that lives in the repository", () => {
    process.chdir(repoRoot);
    const report = new Report("guard");
    const doc = loadDocument(join("bench", "fixtures", "login-card-reference", "document.paprika.json"), report);
    assert.equal(report.results.length, 0, report.results.map((r) => r.name).join(" | "));
    assert.equal(doc.format, "paprika/1");
    assert.ok(Object.keys(doc.nodes).length > 0);
  });
});
