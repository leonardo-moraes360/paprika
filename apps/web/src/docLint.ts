import { useEffect, useSyncExternalStore } from "react";
import type { Document } from "@paprika/core";
import { countNodes, diffDocuments, LintRunner, patchSize, type LintRequest, type LintSummary } from "./lintRunner";

export interface LintTransport {
  post(req: LintRequest): void;
  close(): void;
}

export type TransportFactory = (emit: (summary: LintSummary, id: string) => void) => LintTransport;

const RESET_RATIO = 0.5;

export const workerTransport: TransportFactory = (emit) => {
  if (typeof Worker === "undefined") return inlineTransport(emit);
  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL("./lint.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return inlineTransport(emit);
  }
  worker.onmessage = (ev: MessageEvent<{ id: string; summary: LintSummary }>) => emit(ev.data.summary, ev.data.id);
  return { post: (req) => worker!.postMessage(req), close: () => worker!.terminate() };
};

export const inlineTransport: TransportFactory = (emit) => {
  const runner = new LintRunner(emit, 400);
  return { post: (req) => runner.receive(req), close: () => runner.dispose() };
};

type Listener = () => void;

export class DocLint {
  private transport: LintTransport | null = null;
  private sent: Document | null = null;
  private sentCount = 0;
  private result: { id: string; summary: LintSummary } | null = null;
  private listeners = new Set<Listener>();
  private queued: Document | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  posts = 0;
  resets = 0;
  patchedNodes = 0;

  constructor(
    private readonly factory: TransportFactory = workerTransport,
    private readonly coalesceMs = 100,
  ) {}

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getResult = (docId: string): LintSummary | null => (this.result && this.result.id === docId ? this.result.summary : null);

  update(doc: Document): void {
    if (this.sent === doc || this.queued === doc) return;
    this.queued = doc;
    if (this.timer === undefined) this.timer = setTimeout(() => this.flush(), this.coalesceMs);
  }

  flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    const doc = this.queued;
    this.queued = null;
    if (!doc || this.sent === doc) return;
    if (!this.transport) {
      this.transport = this.factory((summary, id) => {
        this.result = { id, summary };
        for (const l of this.listeners) l();
      });
    }
    const prev = this.sent;
    this.sent = doc;
    const count = countNodes(doc.nodes);
    const prevCount = this.sentCount;
    this.sentCount = count;
    this.posts++;
    if (!prev || prev.id !== doc.id) {
      this.resets++;
      this.transport.post({ type: "reset", doc });
      return;
    }
    const patch = diffDocuments(prev, doc, prevCount);
    if (patchSize(patch) > count * RESET_RATIO) {
      this.resets++;
      this.transport.post({ type: "reset", doc });
    } else {
      this.patchedNodes += patchSize(patch);
      this.transport.post({ type: "patch", id: doc.id, patch });
    }
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.queued = null;
    this.transport?.close();
    this.transport = null;
    this.sent = null;
    this.result = null;
  }
}

export const docLint = new DocLint();

if (typeof window !== "undefined") {
  Object.defineProperty(window, "__paprikaLint", {
    get: () => ({ posts: docLint.posts, resets: docLint.resets, patchedNodes: docLint.patchedNodes }),
    configurable: true,
  });
}

export function useDocLint(doc: Document, store: DocLint = docLint): LintSummary | null {
  useEffect(() => store.update(doc), [doc, store]);
  return useSyncExternalStore(store.subscribe, () => store.getResult(doc.id));
}
