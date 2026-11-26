import { lintDocument, type Document, type LintIssue, type Node } from "@paprika/core";

export interface LintSummary {
  count: number;
  top: LintIssue[];
}

export interface DocPatch {
  name: string;
  rootIds: string[];
  nodes: { set: Record<string, Node>; del: string[] };
  tokens: Document["tokens"];
  modes: Document["modes"];
  tokenMeta: Document["tokenMeta"];
  assets: Document["assets"];
}

export type LintRequest = { type: "reset"; doc: Document } | { type: "patch"; id: string; patch: DocPatch };

export const LINT_TOP = 30;

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
    const n = next.nodes[id]!;
    const p = prev.nodes[id];
    if (p === n) continue;
    set[id] = n;
    if (p === undefined) added = true;
  }
  if (added || count !== prevCount) for (const id in prev.nodes) if (!Object.hasOwn(next.nodes, id)) del.push(id);
  return { name: next.name, rootIds: next.rootIds, nodes: { set, del }, tokens: next.tokens, modes: next.modes, tokenMeta: next.tokenMeta, assets: next.assets };
}

export function patchSize(patch: DocPatch): number {
  return Object.keys(patch.nodes.set).length + patch.nodes.del.length;
}

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

export function summarize(doc: Document): LintSummary {
  const issues = lintDocument(doc).filter((i) => i.severity !== "info");
  return { count: issues.length, top: issues.slice(0, LINT_TOP) };
}

export class LintRunner {
  private doc: Document | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private runs = 0;

  constructor(
    private readonly emit: (summary: LintSummary, id: string) => void,
    private readonly delayMs = 120,
    private readonly lint: (doc: Document) => LintSummary = summarize,
  ) {}

  get runCount(): number {
    return this.runs;
  }

  receive(req: LintRequest): void {
    if (req.type === "reset") this.doc = req.doc;
    else if (this.doc && this.doc.id === req.id) this.doc = applyPatch(this.doc, req.patch);
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
