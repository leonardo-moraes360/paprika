import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const script = join(repoRoot, ".github", "scripts", "go-affected.sh");

const MODULE = "example.com/paprika";
const pkg = (name) => `${MODULE}/${name}`;

const ALL = [pkg("leaf"), pkg("mid"), pkg("other"), pkg("top")];

function goAvailable() {
  try {
    execFileSync("go", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const skipWithoutGo = goAvailable() ? false : "no go on PATH: go-affected.sh runs `go list`";

const git = (dir, ...args) =>
  execFileSync(
    "git",
    ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args],
    { cwd: dir, encoding: "utf8" },
  ).trim();

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "go-affected-"));
  const write = (path, contents) => {
    const target = join(dir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  };

  mkdirSync(join(dir, ".github", "scripts"), { recursive: true });
  copyFileSync(script, join(dir, ".github", "scripts", "go-affected.sh"));
  write("server/go.mod", `module ${MODULE}\n\ngo 1.21\n`);
  write("server/leaf/leaf.go", `package leaf\n\nconst Name = "leaf"\n`);
  write("server/mid/mid.go", `package mid\n\nimport "${MODULE}/leaf"\n\nvar Dep = leaf.Name\n`);
  write("server/top/top.go", `package top\n\nimport "${MODULE}/mid"\n\nvar Dep = mid.Dep\n`);
  write("server/other/other.go", `package other\n\nconst Name = "other"\n`);
  write("server/other/other_test.go", `package other_test\n\nimport (\n\t"testing"\n\n\t"${MODULE}/mid"\n)\n\nfunc TestDep(t *testing.T) {\n\t_ = mid.Dep\n}\n`);
  write("server/README.md", "# module\n");

  git(dir, "init", "-q", "-b", "main");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "fixture: top -> mid -> leaf, plus other");
  const base = git(dir, "rev-parse", "HEAD");

  return {
    commit(files, message = "change") {
      for (const [path, contents] of Object.entries(files)) write(path, contents);
      git(dir, "add", "-A");
      git(dir, "commit", "-q", "-m", message);
    },
    run({ shard, total, env = {}, allowFailure = false } = {}) {
      const args = [script, base];
      if (shard !== undefined) args.push(String(shard), String(total));
      try {
        const out = execFileSync("bash", args, {
          cwd: dir,
          encoding: "utf8",
          env: { ...process.env, CI_FULL: "0", ...env },
        });
        return { lines: out.split("\n").filter(Boolean), status: 0 };
      } catch (error) {
        if (!allowFailure) throw error;
        return { lines: String(error.stdout ?? "").split("\n").filter(Boolean), status: error.status };
      }
    },
    packages(options) {
      return this.run(options).lines;
    },
    close() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe("go-affected.sh", { skip: skipWithoutGo }, () => {
  it("a package nobody imports selects only itself", () => {
    const f = fixture();
    try {
      f.commit({ "server/top/top.go": "package top\n\nvar Dep = 2\n" });
      assert.deepEqual(f.packages(), [pkg("top")]);
    } finally {
      f.close();
    }
  });

  it("a changed package selects its transitive importers", () => {
    const f = fixture();
    try {
      f.commit({ "server/leaf/leaf.go": 'package leaf\n\nconst Name = "leaf v2"\n' });
      assert.deepEqual(f.packages(), ALL);
    } finally {
      f.close();
    }
  });

  it("an importer that only appears in a test package counts", () => {
    const f = fixture();
    try {
      f.commit({ "server/mid/mid.go": "package mid\n\nvar Dep = 3\n" });
      assert.deepEqual(f.packages(), [pkg("mid"), pkg("other"), pkg("top")]);
    } finally {
      f.close();
    }
  });

  it("a testdata/ file belongs to its package", () => {
    const f = fixture();
    try {
      f.commit({ "server/mid/testdata/case.json": '{"fixture": true}\n' }, "test: new fixture for mid");
      assert.deepEqual(f.packages(), [pkg("mid"), pkg("other"), pkg("top")]);
    } finally {
      f.close();
    }
  });

  it("go.mod or go.sum selects every package", () => {
    for (const [path, contents] of [
      ["server/go.mod", `module ${MODULE}\n\ngo 1.22\n`],
      ["server/go.sum", "// no dependencies; a checksum file change still rebuilds everything\n"],
    ]) {
      const f = fixture();
      try {
        f.commit({ [path]: contents }, "build(go): dependency change");
        assert.deepEqual(f.packages(), ALL, path);
      } finally {
        f.close();
      }
    }
  });

  it("CI_FULL=1 selects every package even without a Go change", () => {
    const f = fixture();
    try {
      f.commit({ "server/README.md": "# module\n\nMore prose.\n" }, "docs: module readme");
      assert.deepEqual(f.packages({ env: { CI_FULL: "1" } }), ALL);
      assert.deepEqual(f.packages(), []);
    } finally {
      f.close();
    }
  });

  it("an empty selection succeeds with no output", () => {
    for (const path of ["server/README.md", "server/scripts/run.sh"]) {
      const f = fixture();
      try {
        f.commit({ [path]: path.endsWith(".sh") ? "#!/bin/sh\necho hi\n" : "# module\n\nProse.\n" }, "chore: no go file");
        const { lines, status } = f.run({ allowFailure: true });
        assert.equal(status, 0, `${path}: the selector must not fail on an empty selection`);
        assert.deepEqual(lines, [], path);
      } finally {
        f.close();
      }
    }
  });

  it("a change outside server selects nothing", () => {
    const f = fixture();
    try {
      f.commit({ "docs/en-US/architecture.md": "# architecture\n" }, "docs: elsewhere in the repository");
      const { lines, status } = f.run({ allowFailure: true });
      assert.equal(status, 0);
      assert.deepEqual(lines, []);
    } finally {
      f.close();
    }
  });

  it("several commits in the range union their packages", () => {
    const f = fixture();
    try {
      f.commit({ "server/top/top.go": "package top\n\nvar Dep = 5\n" }, "first");
      f.commit({ "server/leaf/leaf.go": 'package leaf\n\nconst Name = "leaf v2"\n' }, "second");
      assert.deepEqual(f.packages(), ALL);
    } finally {
      f.close();
    }
  });

  it("shards are disjoint and cover the whole selection", () => {
    const f = fixture();
    try {
      f.commit({ "server/mid/mid.go": "package mid\n\nvar Dep = 6\n" });
      const all = f.packages();
      assert.equal(all.length, 3, "the selection is big enough to split");
      const one = f.packages({ shard: 1, total: 2 });
      const two = f.packages({ shard: 2, total: 2 });
      assert.deepEqual(one, [pkg("mid"), pkg("top")]);
      assert.deepEqual(two, [pkg("other")]);
      assert.deepEqual(one.filter((p) => two.includes(p)), [], "shards stay disjoint");
      assert.deepEqual([...one, ...two].sort(), all.slice().sort(), "shards cover the selection");
      assert.deepEqual(f.packages({ shard: 1, total: 1 }), all, "one shard is the whole selection");
      assert.deepEqual(f.packages({ shard: 1, total: 4 }).length, 1, "a fourth of four shards");
    } finally {
      f.close();
    }
  });

  it("the range is base..HEAD of the checked-out branch", () => {
    const f = fixture();
    try {
      f.commit({ "server/mid/mid.go": "package mid\n\nvar Dep = 4\n" });
      f.commit({ "server/leaf/leaf.go": 'package leaf\n\nconst Name = "leaf v3"\n' });
      assert.deepEqual(f.packages(), [pkg("leaf"), pkg("mid"), pkg("other"), pkg("top")]);
    } finally {
      f.close();
    }
  });
});
