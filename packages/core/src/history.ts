import { applyOps, type ApplyResult, type Op } from "./ops.js";
import type { Document } from "./schema.js";

export interface HistoryEntry {
  /** Quem originou a transação (ex.: "user", "agent:claude"). */
  actor: string;
  label: string;
  ops: Op[];
  inverse: Op[];
  at: number;
  /** Batch name when several calls were merged into this entry (see `apply`). */
  batch?: string;
}

/**
 * Pilhas de desfazer/refazer sobre um documento imutável. Agente e humano compartilham o mesmo
 * histórico, então um "desfazer" no canvas também desfaz uma edição feita via MCP.
 */
export class History {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  /** The entry the last `apply` pushed or merged into; only it can take more writes of its batch. */
  private open: HistoryEntry | undefined;

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

  /**
   * Applies one transaction. With `batch`, a write from the same actor and batch that directly
   * follows the previous one joins its entry, so one undo reverts the whole batch. Any other write,
   * undo or redo in between closes the batch.
   */
  apply(ops: Op[], actor = "user", label = "", batch?: string): ApplyResult {
    const result = applyOps(this.current, ops);
    this.current = result.doc;
    const top = this.undoStack[this.undoStack.length - 1];
    if (batch !== undefined && top && top === this.open && top.batch === batch && top.actor === actor) {
      const merged: HistoryEntry = { ...top, label: batch, ops: [...top.ops, ...ops], inverse: [...result.inverse, ...top.inverse] };
      this.undoStack[this.undoStack.length - 1] = merged;
      this.open = merged;
    } else {
      const entry: HistoryEntry = { actor, label, ops, inverse: result.inverse, at: Date.now(), ...(batch !== undefined ? { batch } : {}) };
      this.undoStack.push(entry);
      this.open = entry;
      if (this.undoStack.length > this.limit) this.undoStack.shift();
    }
    this.redoStack = [];
    return result;
  }

  undo(): HistoryEntry | undefined {
    const entry = this.undoStack.pop();
    if (!entry) return undefined;
    this.open = undefined;
    const result = applyOps(this.current, entry.inverse);
    this.current = result.doc;
    this.redoStack.push({ ...entry, inverse: result.inverse });
    return entry;
  }

  redo(): HistoryEntry | undefined {
    const entry = this.redoStack.pop();
    if (!entry) return undefined;
    this.open = undefined;
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
    this.open = undefined;
  }
}
