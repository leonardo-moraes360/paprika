import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)),
  configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
  server: { middlewareMode: true },
  logLevel: "warn",
});
const { DocLint } = await server.ssrLoadModule("/src/docLint.ts");
const { LintRunner, diffDocuments, applyPatch, summarize } = await server.ssrLoadModule("/src/lintRunner.ts");
const { RenderIndexer } = await server.ssrLoadModule("/src/renderIndex.ts");
after(() => server.close());

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (id, parentId, extra = {}) => ({ id, type: "text", name: id, parentId, text: "hello", fontSize: 14, color: "#111111", width: "hug", height: "hug", ...extra });
const doc = (count, id = "d") => {
  const nodes = { pg: { id: "pg", type: "page", name: "pg", parentId: null, children: [] } };
  for (let i = 0; i < count; i++) {
    nodes[`t${i}`] = text(`t${i}`, "pg");
    nodes.pg.children.push(`t${i}`);
  }
  return { format: "paprika/1", id, name: "D", tokens: {}, rootIds: ["pg"], nodes };
};
const edit = (d, id, props) => ({ ...d, nodes: { ...d.nodes, [id]: { ...d.nodes[id], ...props } } });

const fakeTransport = () => {
  const posted = [];
  let emit = null;
  const factory = (e) => {
    emit = e;
    return { post: (r) => posted.push(r), close() {} };
  };
  return { posted, factory, reply: (summary, id = "d") => emit(summary, id) };
};

describe("lint patches", () => {
  it("diffs only the nodes whose identity changed and reapplies them", () => {
    const a = doc(50);
    const b = edit(a, "t7", { fontSize: 8 });
    const patch = diffDocuments(a, b);
    assert.deepEqual(Object.keys(patch.nodes.set), ["t7"]);
    assert.deepEqual(patch.nodes.del, []);
    const rebuilt = applyPatch(a, patch);
    assert.deepEqual(rebuilt, b);
  });

  it("carries removals", () => {
    const a = doc(5);
    const nodes = { ...a.nodes };
    delete nodes.t3;
    nodes.pg = { ...nodes.pg, children: nodes.pg.children.filter((c) => c !== "t3") };
    const b = { ...a, nodes };
    const patch = diffDocuments(a, b);
    assert.deepEqual(patch.nodes.del, ["t3"]);
    assert.deepEqual(applyPatch(a, patch), b);
  });

  it("summarizes like lintDocument without the info severity", () => {
    const d = edit(doc(3), "t1", { fontSize: 6 });
    const s = summarize(d);
    assert.equal(s.count, 1);
    assert.equal(s.top[0].rule, "small-text");
    assert.equal(s.top[0].nodeId, "t1");
  });
});

describe("LintRunner", () => {
  it("runs the lint once for a burst of patches", async () => {
    const out = [];
    const runner = new LintRunner((s) => out.push(s), 20);
    let d = doc(10);
    runner.receive({ type: "reset", doc: d });
    for (let i = 0; i < 20; i++) {
      const next = edit(d, `t${i % 10}`, { fontSize: 20 + i });
      runner.receive({ type: "patch", id: "d", patch: diffDocuments(d, next) });
      d = next;
    }
    await wait(80);
    assert.equal(runner.runCount, 1);
    assert.equal(out.length, 1);
    runner.dispose();
  });

  it("ignores a patch for another document", async () => {
    const runner = new LintRunner(() => {}, 5);
    runner.receive({ type: "reset", doc: doc(3, "a") });
    runner.receive({ type: "patch", id: "b", patch: diffDocuments(doc(3, "b"), edit(doc(3, "b"), "t0", { fontSize: 1 })) });
    await wait(30);
    assert.equal(runner.runCount, 1);
    runner.dispose();
  });
});

describe("DocLint", () => {
  it("sends a reset first, then patches the size of the change, never the whole document", () => {
    const t = fakeTransport();
    const lint = new DocLint(t.factory, 0);
    const d0 = doc(400);
    lint.update(d0);
    lint.flush();
    assert.equal(t.posted.length, 1);
    assert.equal(t.posted[0].type, "reset");
    const d1 = edit(d0, "t5", { fontSize: 9 });
    lint.update(d1);
    lint.flush();
    assert.equal(t.posted[1].type, "patch");
    assert.deepEqual(Object.keys(t.posted[1].patch.nodes.set), ["t5"]);
  });

  it("coalesces versions that arrive within the window into one patch against the last one sent", async () => {
    const t = fakeTransport();
    const lint = new DocLint(t.factory, 15);
    let d = doc(100);
    lint.update(d);
    lint.flush();
    for (let i = 0; i < 30; i++) {
      d = edit(d, `t${i}`, { fontSize: 20 + i });
      lint.update(d);
    }
    assert.equal(t.posted.length, 1);
    await wait(60);
    assert.equal(t.posted.length, 2);
    assert.equal(Object.keys(t.posted[1].patch.nodes.set).length, 30);
  });

  it("resets on another document and reports results only for the current document", () => {
    const t = fakeTransport();
    const lint = new DocLint(t.factory, 0);
    lint.update(doc(3, "a"));
    lint.flush();
    t.reply({ count: 2, top: [] }, "a");
    assert.equal(lint.getResult("a").count, 2);
    assert.equal(lint.getResult("b"), null);
    lint.update(doc(3, "b"));
    lint.flush();
    assert.equal(t.posted[1].type, "reset");
  });

  it("does nothing for the same document object", () => {
    const t = fakeTransport();
    const lint = new DocLint(t.factory, 0);
    const d = doc(3);
    lint.update(d);
    lint.flush();
    lint.update(d);
    lint.flush();
    assert.equal(t.posted.length, 1);
  });
});

describe("RenderIndexer incremental versions", () => {
  const tree = () => {
    const nodes = { pg: { id: "pg", type: "page", name: "pg", parentId: null, children: ["f"] }, f: { id: "f", type: "frame", name: "f", parentId: "pg", children: ["a", "b"], width: 100, height: 100 } };
    nodes.a = { id: "a", type: "rect", name: "a", parentId: "f", width: 10, height: 10 };
    nodes.b = { id: "b", type: "frame", name: "b", parentId: "f", children: ["c"], width: 10, height: 10 };
    nodes.c = { id: "c", type: "rect", name: "c", parentId: "b", width: 10, height: 10 };
    for (let i = 0; i < 200; i++) {
      nodes[`x${i}`] = { id: `x${i}`, type: "rect", name: "x", parentId: "pg", width: 1, height: 1 };
      nodes.pg.children.push(`x${i}`);
    }
    return { format: "paprika/1", id: "d", name: "D", tokens: {}, rootIds: ["pg"], nodes };
  };
  const set = (d, id, props) => ({ ...d, nodes: { ...d.nodes, [id]: { ...d.nodes[id], ...props } } });
  const moved = (a, b) => [...b.vers].filter(([id, v]) => a.vers.get(id) !== v).map(([id]) => id).sort();
  const related = (d, id) => {
    const out = new Set([id]);
    for (let p = d.nodes[id].parentId; p; p = d.nodes[p].parentId) out.add(p);
    const stack = [id];
    while (stack.length) for (const c of d.nodes[stack.pop()].children ?? []) (out.add(c), stack.push(c));
    return out;
  };

  it("moves exactly the node, its ancestors and its descendants on a prop write", () => {
    const ix = new RenderIndexer();
    const d0 = tree();
    const i0 = ix.index(d0);
    for (const id of ["a", "b", "c", "f", "x7", "pg"]) {
      const before = ix.index(d0 === undefined ? d0 : ix.index(d0).doc);
      const d1 = set(before.doc, id, { width: 55 + id.length });
      const after = ix.index(d1);
      assert.deepEqual(moved(before, after), [...related(d1, id)].sort(), id);
    }
    assert.ok(i0.vers.size > 200);
  });

  it("keeps ordering between a newer write and everything it does not touch", () => {
    const ix = new RenderIndexer();
    const d0 = tree();
    ix.index(d0);
    const d1 = set(set(d0, "c", { width: 3 }), "x4", { width: 2 });
    const r = ix.index(d1);
    const touched = new Set([...related(d1, "c"), ...related(d1, "x4")]);
    const untouchedMax = Math.max(...[...r.vers].filter(([id]) => !touched.has(id)).map(([, v]) => v));
    for (const id of ["c", "x4", "b", "f", "pg"]) assert.ok(r.vers.get(id) > untouchedMax, id);
  });

  it("bumps the affected chain on structural changes too", () => {
    const ix = new RenderIndexer();
    const d0 = tree();
    const before = ix.index(d0);
    const added = { ...d0, nodes: { ...d0.nodes, n1: { id: "n1", type: "rect", name: "n", parentId: "b", width: 1, height: 1 }, b: { ...d0.nodes.b, children: ["c", "n1"] } } };
    const after = ix.index(added);
    assert.deepEqual(moved(before, after), [...related(added, "b"), "n1"].filter((v, i, a) => a.indexOf(v) === i).sort());
    const removed = { ...added, nodes: Object.fromEntries(Object.entries(added.nodes).filter(([id]) => id !== "n1")) };
    removed.nodes.b = { ...added.nodes.b, children: ["c"] };
    const gone = ix.index(removed);
    assert.equal(gone.vers.has("n1"), false);
    assert.ok(gone.vers.get("b") > after.vers.get("b"));
  });

  it("handles a node moved to another parent without touching unrelated nodes", () => {
    const ix = new RenderIndexer();
    const d0 = tree();
    const before = ix.index(d0);
    const nodes = { ...d0.nodes };
    nodes.a = { ...nodes.a, parentId: "b" };
    nodes.f = { ...nodes.f, children: ["b"] };
    nodes.b = { ...nodes.b, children: ["c", "a"] };
    const d1 = { ...d0, nodes };
    const after = ix.index(d1);
    const expected = new Set([...related(d1, "a"), ...related(d1, "b"), ...related(d1, "f")]);
    assert.deepEqual(moved(before, after), [...expected].sort());
    assert.equal(after.vers.get("x9"), before.vers.get("x9"));
  });
});
