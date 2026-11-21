import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { existsSync, watch, type FSWatcher } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { History, createDocument, parseDocument, type ApplyResult, type Document, type Op } from "@paprika/core";

export interface ChangeEvent {
  doc: Document;
  version: number;
  actor: string;
  label: string;
  kind: "apply" | "undo" | "redo" | "reload";
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Dono do documento em memória e no disco. Toda mutação passa por `History.apply` (applyOps),
 * é persistida com escrita atômica e emitida como evento `change` para o canvas e os agentes.
 */
export class DocumentStore extends EventEmitter<{ change: [ChangeEvent]; error: [Error] }> {
  private history!: History;
  private versionNo = 0;
  private lastWrittenHash = "";
  private writeChain: Promise<void> = Promise.resolve();
  private watcher?: FSWatcher;

  private constructor(readonly file: string) {
    super();
  }

  static async open(file: string, opts: { watch?: boolean } = {}): Promise<DocumentStore> {
    const store = new DocumentStore(file);
    if (existsSync(file)) {
      const raw = await readFile(file, "utf8");
      store.history = new History(parseDocument(JSON.parse(raw)));
      store.lastWrittenHash = sha(raw);
    } else {
      const name = basename(file).replace(/\.paprika\.json$|\.json$/, "") || "Sem título";
      store.history = new History(createDocument(name));
      await store.persist();
    }
    if (opts.watch !== false) store.startWatching();
    return store;
  }

  get doc(): Document {
    return this.history.doc;
  }

  get version(): number {
    return this.versionNo;
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  recentHistory(limit = 20): { actor: string; label: string; at: number; ops: number }[] {
    return this.history
      .entries()
      .slice(-limit)
      .map((e) => ({ actor: e.actor, label: e.label, at: e.at, ops: e.ops.length }));
  }

  /** `batch`: merge into the previous entry of the same actor and batch (one undo step). */
  apply(ops: Op[], actor: string, label = "", batch?: string): ApplyResult {
    const result = this.history.apply(ops, actor, label, batch);
    this.commit(actor, label, "apply");
    return result;
  }

  undo(actor: string): boolean {
    const entry = this.history.undo();
    if (!entry) return false;
    this.commit(actor, `desfazer: ${entry.label || entry.actor}`, "undo");
    return true;
  }

  redo(actor: string): boolean {
    const entry = this.history.redo();
    if (!entry) return false;
    this.commit(actor, `refazer: ${entry.label || entry.actor}`, "redo");
    return true;
  }

  private commit(actor: string, label: string, kind: ChangeEvent["kind"]): void {
    this.versionNo++;
    void this.persist().catch((e: Error) => this.emit("error", e));
    this.emit("change", { doc: this.doc, version: this.versionNo, actor, label, kind });
  }

  /** Resolve quando todas as gravações pendentes chegaram ao disco. */
  flush(): Promise<void> {
    return this.writeChain;
  }

  /** Escrita atômica (tmp + rename), serializada para nunca intercalar duas gravações. */
  persist(): Promise<void> {
    const content = JSON.stringify(this.doc, null, 2) + "\n";
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      const tmp = join(dirname(this.file), `.${basename(this.file)}.${process.pid}.tmp`);
      this.lastWrittenHash = sha(content);
      await writeFile(tmp, content, "utf8");
      await rename(tmp, this.file);
    });
    return this.writeChain;
  }

  /** Recarrega quando outro processo (ou um humano no editor) altera o arquivo. */
  private startWatching(): void {
    let timer: NodeJS.Timeout | undefined;
    try {
      this.watcher = watch(dirname(this.file), (_evt, name) => {
        if (name !== basename(this.file)) return;
        clearTimeout(timer);
        timer = setTimeout(() => void this.reloadIfChanged(), 50);
      });
    } catch {
      // Sem watch (ex.: alguns FS de rede): o documento em memória segue como fonte.
    }
  }

  async reloadIfChanged(): Promise<boolean> {
    if (!existsSync(this.file)) return false;
    await this.writeChain;
    const raw = await readFile(this.file, "utf8");
    if (sha(raw) === this.lastWrittenHash) return false;
    try {
      const doc = parseDocument(JSON.parse(raw));
      this.lastWrittenHash = sha(raw);
      this.history.reset(doc);
      this.versionNo++;
      this.emit("change", { doc, version: this.versionNo, actor: "file", label: "arquivo alterado externamente", kind: "reload" });
      return true;
    } catch (e) {
      this.emit("error", new Error(`ignorando alteração externa inválida em ${this.file}: ${(e as Error).message}`));
      return false;
    }
  }

  async close(): Promise<void> {
    this.watcher?.close();
    await this.writeChain;
  }
}
