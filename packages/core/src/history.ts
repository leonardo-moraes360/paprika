import { applyOps, type ApplyResult, type Op } from "./ops.js";
import type { Document } from "./schema.js";

export interface HistoryEntry {
  /** Quem originou a transação (ex.: "user", "agent:claude"). */
  actor: string;
  label: string;
  ops: Op[];
  inverse: Op[];
  at: number;
}

/**
 * Pilhas de desfazer/refazer sobre um documento imutável. Agente e humano compartilham o mesmo
 * histórico, então um "desfazer" no canvas também desfaz uma edição feita via MCP.
 */
export class History {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];

  constructor(
    private current: Document,
    private readonly limit = 500,
  ) {}

  get doc(): Document {
    return this.current;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  entries(): readonly HistoryEntry[] {
    return this.undoStack;
  }

  apply(ops: Op[], actor = "user", label = ""): ApplyResult {
    const result = applyOps(this.current, ops);
    this.current = result.doc;
    this.undoStack.push({ actor, label, ops, inverse: result.inverse, at: Date.now() });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    return result;
  }

  undo(): HistoryEntry | undefined {
    const entry = this.undoStack.pop();
    if (!entry) return undefined;
    const result = applyOps(this.current, entry.inverse);
    this.current = result.doc;
    this.redoStack.push({ ...entry, inverse: result.inverse });
    return entry;
  }

  redo(): HistoryEntry | undefined {
    const entry = this.redoStack.pop();
    if (!entry) return undefined;
    const result = applyOps(this.current, entry.inverse);
    this.current = result.doc;
    this.undoStack.push({ ...entry, inverse: result.inverse });
    return entry;
  }

  /** Substitui o documento (ex.: arquivo alterado fora do processo) e zera o histórico. */
  reset(doc: Document): void {
    this.current = doc;
    this.undoStack = [];
    this.redoStack = [];
  }
}
