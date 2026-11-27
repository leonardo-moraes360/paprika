import { lintDocument, type Document, type LintIssue, type Node } from "@paprika/core";

/** What the panel needs: how many issues (info excluded) and the first `LINT_TOP` of them. */
export type LintSummary = { count: number; top: LintIssue[] };

/** What a patch carries: the changed or new nodes, the deleted ids, and the small document-level maps whole. */
export type DocPatch = {
  name: string;
  rootIds: string[];
  nodes: { set: Record<string, Node>; del: string[] };
  tokens: Document["tokens"];
  modes: Document["modes"];
  tokenMeta: Document["tokenMeta"];
  assets: Document["assets"];
};

export type LintRequest = { type: "reset"; doc: Document } | { type: "patch"; id: string; patch: DocPatch };

export const LINT_TOP = 30;
/** A patch bigger than this share of the nodes is cheaper to send as a whole document. */
export const RESET_RATIO = 0.5;

export function countNodes(nodes: Document["nodes"]): number {
  let n = 0;
  for (const _ in nodes) n++;
  return n;
}

export function diffDocuments(prev: Document, next: Document, prevCount = countNodes(prev.nodes)): DocPatch {
  const set: Record<string, Node> = {};
  const del: string[] = [];
  let count = 0;
  let added = false;
  for (const id in next.nodes) {
    count++;
    const node = next.nodes[id] as Node;
    const before = prev.nodes[id];
    if (before === node) continue;
    set[id] = node;
    if (before === undefined) added = true;
  }
  if (added || count !== prevCount) for (const id in prev.nodes) if (!Object.hasOwn(next.nodes, id)) del.push(id);
  return { name: next.name, rootIds: next.rootIds, nodes: { set, del }, tokens: next.tokens, modes: next.modes, tokenMeta: next.tokenMeta, assets: next.assets };
}

export const patchSize = (patch: DocPatch) => Object.keys(patch.nodes.set).length + patch.nodes.del.length;

export function applyPatch(doc: Document, patch: DocPatch): Document {
  const nodes = { ...doc.nodes, ...patch.nodes.set } as Document["nodes"];
  for (const id of patch.nodes.del) Reflect.deleteProperty(nodes, id);
  const next: Record<string, unknown> = { ...doc, name: patch.name, rootIds: patch.rootIds, nodes, tokens: patch.tokens };
  for (const key of ["modes", "tokenMeta", "assets"] as const) {
    if (patch[key] === undefined) Reflect.deleteProperty(next, key);
    else next[key] = patch[key];
  }
  return next as unknown as Document;
}

/** `lintDocument` from core, without `info`, and only the first `LINT_TOP` kept. */
export function summarize(doc: Document): LintSummary {
  const issues = lintDocument(doc).filter((issue) => issue.severity !== "info");
  return { count: issues.length, top: issues.slice(0, LINT_TOP) };
}

/** Holds the document inside the worker (or inline), applies requests to it and lints it after a short quiet period. */
export class LintRunner {
  private doc: Document | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private runs = 0;

  constructor(
    private readonly emit: (summary: LintSummary, id: string) => void,
    private readonly delayMs = 120,
    private readonly lint: (doc: Document) => LintSummary = summarize,
  ) {}

  get runCount() {
    return this.runs;
  }

  receive(request: LintRequest): void {
    if (request.type === "reset") this.doc = request.doc;
    else if (this.doc && this.doc.id === request.id) this.doc = applyPatch(this.doc, request.patch);
    else return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.run(), this.delayMs);
  }

  flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.run();
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.doc = null;
  }

  private run(): void {
    this.timer = undefined;
    if (!this.doc) return;
    this.runs++;
    this.emit(this.lint(this.doc), this.doc.id);
  }
}
