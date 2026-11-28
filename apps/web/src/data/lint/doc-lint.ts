import type { Document } from "@paprika/core";
import { countNodes, diffDocuments, LintRunner, patchSize, RESET_RATIO, type LintRequest, type LintSummary } from "./lint-runner";

export type LintTransport = { post: (request: LintRequest) => void; close: () => void };
export type TransportFactory = (emit: (summary: LintSummary, id: string) => void) => LintTransport;

/** Lints on the main thread, a little later than the worker would (the fallback when there is no `Worker`). */
export const inlineTransport: TransportFactory = (emit) => {
  const runner = new LintRunner(emit, 400);
  return { post: (request) => runner.receive(request), close: () => runner.dispose() };
};

/** A transport that lints nothing and never answers (tests that count commits: no lint result arrives to commit anything). */
export const nullTransport: TransportFactory = () => ({ post: () => {}, close: () => {} });

/** The worker holds its own copy of the document and lints it off the main thread; no `Worker`, or one that will not start, falls back to inline. */
export const workerTransport: TransportFactory = (emit) => {
  if (typeof Worker === "undefined") return inlineTransport(emit);
  let worker: Worker;
  try {
    worker = new Worker(new URL("./lint.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return inlineTransport(emit);
  }
  worker.onmessage = (event: MessageEvent<{ id: string; summary: LintSummary }>) => emit(event.data.summary, event.data.id);
  return { post: (request) => worker.postMessage(request), close: () => worker.terminate() };
};

const sameSummary = (a: LintSummary, b: LintSummary) =>
  a.count === b.count && a.top.length === b.top.length && a.top.every((issue, i) => {
    const other = b.top[i];
    return other !== undefined && issue.nodeId === other.nodeId && issue.rule === other.rule && issue.message === other.message && issue.severity === other.severity;
  });

/** The longest the first `reset` waits for an idle moment. */
export const IDLE_TIMEOUT_MS = 1500;

export type DocLintStats = { posts: number; resets: number; patchedNodes: number };

/**
 * Feeds documents to a lint transport: updates are coalesced (100 ms), the first one and a change of document are a
 * `reset`, a patch bigger than half of the nodes is a `reset` too, anything else is a `patch`. Made per editor, never at import time.
 */
export class DocLint {
  private transport: LintTransport | null = null;
  private sent: Document | null = null;
  private sentCount = 0;
  private result: { id: string; summary: LintSummary } | null = null;
  private listeners = new Set<() => void>();
  private queued: Document | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private idle: number | undefined;
  readonly stats: DocLintStats = { posts: 0, resets: 0, patchedNodes: 0 };

  constructor(
    private readonly factory: TransportFactory = workerTransport,
    private readonly coalesceMs = 100,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** The summary for the document `docId`, or `null` while it is being computed. Same reference until the issues change. */
  getResult = (docId: string | undefined): LintSummary | null => (docId !== undefined && this.result && this.result.id === docId ? this.result.summary : null);

  update(doc: Document): void {
    if (this.sent === doc || this.queued === doc) return;
    this.queued = doc;
    if (this.timer !== undefined || this.idle !== undefined) return;
    // The first document is a `reset` (a structured clone of all of it): it waits for an idle moment (at most `IDLE_TIMEOUT_MS`) so
    // opening the workspace paints first. Later updates keep the plain coalescing timer.
    if (this.sent === null && typeof requestIdleCallback === "function") this.idle = requestIdleCallback(() => this.flush(), { timeout: IDLE_TIMEOUT_MS });
    else this.timer = setTimeout(() => this.flush(), this.coalesceMs);
  }

  private cancelScheduled(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.idle !== undefined && typeof cancelIdleCallback === "function") cancelIdleCallback(this.idle);
    this.idle = undefined;
  }

  flush(): void {
    this.cancelScheduled();
    const doc = this.queued;
    this.queued = null;
    if (!doc || this.sent === doc) return;
    this.transport ??= this.factory((summary, id) => {
      const previous = this.result;
      if (previous && previous.id === id && sameSummary(previous.summary, summary)) return;
      this.result = { id, summary };
      for (const listener of [...this.listeners]) listener();
    });
    const prev = this.sent;
    this.sent = doc;
    const count = countNodes(doc.nodes);
    const prevCount = this.sentCount;
    this.sentCount = count;
    this.stats.posts++;
    if (!prev || prev.id !== doc.id) {
      this.stats.resets++;
      this.transport.post({ type: "reset", doc });
      return;
    }
    const patch = diffDocuments(prev, doc, prevCount);
    if (patchSize(patch) > count * RESET_RATIO) {
      this.stats.resets++;
      this.transport.post({ type: "reset", doc });
    } else {
      this.stats.patchedNodes += patchSize(patch);
      this.transport.post({ type: "patch", id: doc.id, patch });
    }
  }

  dispose(): void {
    this.cancelScheduled();
    this.queued = null;
    this.transport?.close();
    this.transport = null;
    this.sent = null;
    this.result = null;
  }
}
