import type { Document, Node } from "@paprika/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeDocument } from "@/test/live-harness";
import { DocLint, IDLE_TIMEOUT_MS, inlineTransport, nullTransport, workerTransport, type TransportFactory } from "./doc-lint";
import { applyPatch, countNodes, diffDocuments, LINT_TOP, LintRunner, patchSize, summarize, type LintRequest, type LintSummary } from "./lint-runner";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const edit = (doc: Document, id: string, props: Record<string, unknown>): Document => ({ ...doc, nodes: { ...doc.nodes, [id]: { ...doc.nodes[id], ...props } as Node } });

function recorder() {
  const posted: LintRequest[] = [];
  let emit: (summary: LintSummary, id: string) => void = () => {};
  let closed = 0;
  const factory: TransportFactory = (e) => {
    emit = e;
    return { post: (request) => void posted.push(request), close: () => void closed++ };
  };
  return { posted, factory, emit: (summary: LintSummary, id: string) => emit(summary, id), closed: () => closed };
}

describe("lint runner", () => {
  const doc = makeDocument(60, { perFrame: 20 });

  it("a patch carries only what changed, and applying it gives the new document", () => {
    const next = edit(doc, "n5", { x: 99 });
    const patch = diffDocuments(doc, next);
    expect(Object.keys(patch.nodes.set)).toEqual(["n5"]);
    expect(patchSize(patch)).toBe(1);
    expect(applyPatch(doc, patch).nodes.n5).toBe(next.nodes.n5);
    expect(countNodes(doc.nodes)).toBe(60);
  });

  it("a patch lists deleted nodes", () => {
    const nodes = { ...doc.nodes };
    delete nodes.n5;
    const patch = diffDocuments(doc, { ...doc, nodes });
    expect(patch.nodes.del).toEqual(["n5"]);
    expect(applyPatch(doc, patch).nodes.n5).toBeUndefined();
  });

  it("the summary uses core's lint, leaves out info and keeps the first 30", () => {
    const messy = makeDocument(200, { perFrame: 100 });
    for (const id of Object.keys(messy.nodes)) if (id.startsWith("n")) messy.nodes[id] = { ...messy.nodes[id], type: "text", text: "x", color: "#ffffff", fontSize: 4, fontFamily: "Inter", fontWeight: 400, lineHeight: 1.2 } as unknown as Node;
    const summary = summarize(messy);
    expect(summary.top.length).toBeLessThanOrEqual(LINT_TOP);
    expect(summary.count).toBeGreaterThanOrEqual(summary.top.length);
    expect(summary.top.every((issue) => issue.severity !== "info")).toBe(true);
  });

  it("lints once after a quiet period, not once per request", () => {
    const seen: string[] = [];
    const runner = new LintRunner((_, id) => seen.push(id), 120, () => ({ count: 0, top: [] }));
    runner.receive({ type: "reset", doc });
    runner.receive({ type: "patch", id: doc.id, patch: diffDocuments(doc, edit(doc, "n5", { x: 1 })) });
    vi.advanceTimersByTime(119);
    expect(runner.runCount).toBe(0);
    vi.advanceTimersByTime(2);
    expect(runner.runCount).toBe(1);
    expect(seen).toEqual([doc.id]);
  });

  it("ignores a patch for another document", () => {
    const runner = new LintRunner(() => {}, 10, () => ({ count: 0, top: [] }));
    runner.receive({ type: "reset", doc });
    runner.receive({ type: "patch", id: "other", patch: diffDocuments(doc, doc) });
    runner.dispose();
    vi.advanceTimersByTime(50);
    expect(runner.runCount).toBe(0);
  });
});

describe("DocLint feeding", () => {
  const doc = makeDocument(100, { perFrame: 20 });

  it("coalesces updates for 100 ms and posts the last document once, as a reset first", () => {
    const rec = recorder();
    const lint = new DocLint(rec.factory);
    lint.update(doc);
    lint.update(edit(doc, "n5", { x: 1 }));
    lint.update(edit(doc, "n5", { x: 2 }));
    vi.advanceTimersByTime(99);
    expect(rec.posted).toHaveLength(0);
    vi.advanceTimersByTime(2);
    expect(rec.posted).toHaveLength(1);
    expect(rec.posted[0]?.type).toBe("reset");
    expect(lint.stats).toMatchObject({ posts: 1, resets: 1 });
  });

  it("then posts patches, and resets when the patch is over half of the nodes or the document changes", () => {
    const rec = recorder();
    const lint = new DocLint(rec.factory);
    lint.update(doc);
    vi.advanceTimersByTime(100);
    const small = edit(doc, "n5", { x: 1 });
    lint.update(small);
    vi.advanceTimersByTime(100);
    expect(rec.posted[1]).toMatchObject({ type: "patch", id: doc.id });
    expect(lint.stats.patchedNodes).toBe(1);
    const nodes = { ...small.nodes };
    for (const id of Object.keys(nodes).slice(0, 60)) nodes[id] = { ...nodes[id] } as Node;
    lint.update({ ...small, nodes });
    vi.advanceTimersByTime(100);
    expect(rec.posted[2]?.type).toBe("reset");
    lint.update(makeDocument(10, { id: "another" }));
    vi.advanceTimersByTime(100);
    expect(rec.posted[3]?.type).toBe("reset");
    expect(lint.stats.resets).toBe(3);
  });

  it("waits for an idle moment before the first reset (so opening paints first), then coalesces as usual", () => {
    const callbacks: { run: () => void; options?: IdleRequestOptions }[] = [];
    vi.stubGlobal("requestIdleCallback", (run: () => void, options?: IdleRequestOptions) => callbacks.push({ run, options }));
    vi.stubGlobal("cancelIdleCallback", () => {});
    try {
      const rec = recorder();
      const lint = new DocLint(rec.factory);
      lint.update(doc);
      lint.update(edit(doc, "n5", { x: 1 }));
      vi.advanceTimersByTime(5000);
      expect(rec.posted).toHaveLength(0);
      expect(callbacks).toHaveLength(1);
      expect(callbacks[0]?.options).toEqual({ timeout: IDLE_TIMEOUT_MS });
      callbacks[0]?.run();
      expect(rec.posted).toHaveLength(1);
      expect(rec.posted[0]?.type).toBe("reset");
      // After the first one, the 100 ms timer again.
      lint.update(edit(doc, "n6", { x: 2 }));
      expect(callbacks).toHaveLength(1);
      vi.advanceTimersByTime(100);
      expect(rec.posted[1]?.type).toBe("patch");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("the null transport lints nothing and answers nothing", () => {
    const lint = new DocLint(nullTransport);
    const heard = vi.fn();
    lint.subscribe(heard);
    lint.update(doc);
    vi.advanceTimersByTime(1000);
    expect(lint.stats.posts).toBe(1);
    expect(lint.getResult(doc.id)).toBeNull();
    expect(heard).not.toHaveBeenCalled();
  });

  it("does not post a document it already sent", () => {
    const rec = recorder();
    const lint = new DocLint(rec.factory);
    lint.update(doc);
    vi.advanceTimersByTime(100);
    lint.update(doc);
    vi.advanceTimersByTime(100);
    expect(rec.posted).toHaveLength(1);
  });

  it("answers per document id, keeps the same summary while the issues are the same, and tells the listeners only on a change", () => {
    const rec = recorder();
    const lint = new DocLint(rec.factory);
    const heard = vi.fn();
    lint.subscribe(heard);
    lint.update(doc);
    vi.advanceTimersByTime(100);
    expect(lint.getResult(doc.id)).toBeNull();
    const issue = { nodeId: "n1", rule: "contrast", severity: "warning", message: "low" } as never;
    rec.emit({ count: 1, top: [issue] }, doc.id);
    const first = lint.getResult(doc.id);
    expect(first?.count).toBe(1);
    expect(lint.getResult("another")).toBeNull();
    rec.emit({ count: 1, top: [{ ...(issue as object) } as never] }, doc.id);
    expect(lint.getResult(doc.id)).toBe(first);
    expect(heard).toHaveBeenCalledTimes(1);
    rec.emit({ count: 0, top: [] }, doc.id);
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it("dispose closes the transport and forgets the result", () => {
    const rec = recorder();
    const lint = new DocLint(rec.factory);
    lint.update(doc);
    vi.advanceTimersByTime(100);
    rec.emit({ count: 0, top: [] }, doc.id);
    lint.dispose();
    expect(rec.closed()).toBe(1);
    expect(lint.getResult(doc.id)).toBeNull();
  });
});

describe("transports", () => {
  const doc = makeDocument(30, { perFrame: 10 });

  it("without a Worker the lint runs inline, about 400 ms after the request", () => {
    vi.stubGlobal("Worker", undefined);
    const emitted: string[] = [];
    const transport = workerTransport((_, id) => emitted.push(id));
    transport.post({ type: "reset", doc });
    vi.advanceTimersByTime(399);
    expect(emitted).toEqual([]);
    vi.advanceTimersByTime(2);
    expect(emitted).toEqual([doc.id]);
    transport.close();
    vi.unstubAllGlobals();
  });

  it("a Worker that throws on construction falls back to inline too", () => {
    vi.stubGlobal("Worker", class {
      constructor() {
        throw new Error("no worker");
      }
    });
    const emitted: string[] = [];
    const transport = workerTransport((_, id) => emitted.push(id));
    transport.post({ type: "reset", doc });
    vi.advanceTimersByTime(500);
    expect(emitted).toEqual([doc.id]);
    transport.close();
    vi.unstubAllGlobals();
  });

  it("with a Worker, requests go to it and its answers come back", () => {
    const posted: unknown[] = [];
    let instance: { onmessage: ((event: { data: unknown }) => void) | null; terminated: boolean };
    vi.stubGlobal("Worker", class {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      terminated = false;
      constructor() {
        instance = this;
      }
      postMessage(message: unknown) {
        posted.push(message);
      }
      terminate() {
        this.terminated = true;
      }
    });
    const emitted: string[] = [];
    const transport = workerTransport((_, id) => emitted.push(id));
    transport.post({ type: "reset", doc });
    expect(posted).toHaveLength(1);
    instance!.onmessage?.({ data: { id: "d", summary: { count: 0, top: [] } } });
    expect(emitted).toEqual(["d"]);
    transport.close();
    expect(instance!.terminated).toBe(true);
    vi.unstubAllGlobals();
  });

  it("inlineTransport exists as the fallback", () => {
    expect(typeof inlineTransport).toBe("function");
  });
});
