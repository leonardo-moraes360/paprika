import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { existsSync, watch, type FSWatcher, type Stats } from "node:fs";
import { mkdir, open, readFile, readdir, rename, writeFile, type FileHandle } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { History, createDocument, parseDocument, type ApplyResult, type Document, type Op } from "@paprika/core";

export interface ChangeEvent {
  doc: Document;
  version: number;
  actor: string;
  label: string;
  /** `open`: another workspace became the active one. */
  kind: "apply" | "undo" | "redo" | "reload" | "open";
}

/**
 * A workspace is one Paprika document. In the TypeScript server, the workspaces are the
 * `*.paprika.json` files in the folder of `--file`; the id is the document's own `id`.
 */
export interface WorkspaceInfo {
  id: string;
  name: string;
  nodes: number;
  /** Unix ms of the last write (file mtime). */
  updatedAt: number;
  /** The active workspace: the one the canvas and the MCP tools read and write. */
  active: boolean;
}

const WORKSPACE_FILE = /^[^.].*\.paprika\.json$/;

/** File name for a new workspace: the name without accents, lowercase, words joined by "-". */
export function workspaceSlug(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug || "workspace";
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

  private constructor(private currentFile: string) {
    super();
  }

  /** File of the active workspace (changes with `openWorkspace`). */
  get file(): string {
    return this.currentFile;
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

  /** Workspaces in the folder of the active file, most recently updated first (invalid files are skipped). */
  async listWorkspaces(): Promise<WorkspaceInfo[]> {
    return (await this.scanWorkspaces()).map((w) => w.info);
  }

  private async scanWorkspaces(): Promise<{ info: WorkspaceInfo; file: string }[]> {
    const dir = dirname(this.file);
    const names = (await readdir(dir)).filter((n) => WORKSPACE_FILE.test(n)).sort();
    const active = basename(this.file);
    // The active file first, so a copied file with the same id never shadows it.
    if (names.includes(active)) names.splice(names.indexOf(active), 1);
    const out: { info: WorkspaceInfo; file: string }[] = [];
    const seen = new Set<string>();
    for (const name of [active, ...names]) {
      const file = join(dir, name);
      try {
        // One handle for the date and the content, so both describe the same file.
        const fh = await open(file, "r");
        let st: Stats;
        let raw: string | undefined;
        try {
          st = await fh.stat();
          if (name !== active) raw = await fh.readFile("utf8");
        } finally {
          await fh.close();
        }
        const doc = raw === undefined ? this.doc : parseDocument(JSON.parse(raw));
        if (seen.has(doc.id)) continue;
        seen.add(doc.id);
        out.push({
          file,
          info: { id: doc.id, name: doc.name, nodes: Object.keys(doc.nodes).length, updatedAt: Math.round(st.mtimeMs), active: name === active },
        });
      } catch {
        // Not a valid Paprika document (or gone meanwhile): not a workspace.
      }
    }
    return out.sort((a, b) => b.info.updatedAt - a.info.updatedAt || (a.info.id < b.info.id ? -1 : a.info.id > b.info.id ? 1 : 0));
  }

  /**
   * Makes another workspace the active one: the canvas and the MCP tools switch to it (event
   * `change` with kind `open`). Undo history starts empty. Returns undefined if the id is unknown.
   */
  async openWorkspace(id: string, actor: string): Promise<WorkspaceInfo | undefined> {
    const found = (await this.scanWorkspaces()).find((w) => w.info.id === id);
    if (!found) return undefined;
    if (found.info.active) return found.info;
    await this.writeChain;
    const raw = await readFile(found.file, "utf8");
    const doc = parseDocument(JSON.parse(raw));
    this.currentFile = found.file;
    this.lastWrittenHash = sha(raw);
    this.history = new History(doc);
    this.versionNo++;
    this.emit("change", { doc, version: this.versionNo, actor, label: `abrir workspace: ${doc.name}`, kind: "open" });
    return { ...found.info, active: true };
  }

  /** Creates an empty workspace next to the active file (it does not become active). Blank name: "Sem título". */
  async createWorkspace(name: string): Promise<WorkspaceInfo> {
    const doc = createDocument(name.trim() || "Sem título");
    const dir = dirname(this.file);
    const slug = workspaceSlug(doc.name);
    // Exclusive create ("wx"): taking the next free name and creating it is one step, so two
    // creations with the same name never overwrite each other.
    for (let i = 1; ; i++) {
      const file = join(dir, i === 1 ? `${slug}.paprika.json` : `${slug}-${i}.paprika.json`);
      let fh: FileHandle;
      try {
        fh = await open(file, "wx");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "EEXIST") continue;
        throw e;
      }
      try {
        await fh.writeFile(JSON.stringify(doc, null, 2) + "\n", "utf8");
        const st = await fh.stat();
        return { id: doc.id, name: doc.name, nodes: 0, updatedAt: Math.round(st.mtimeMs), active: false };
      } finally {
        await fh.close();
      }
    }
  }

  /** Escrita atômica (tmp + rename), serializada para nunca intercalar duas gravações. */
  persist(): Promise<void> {
    const content = JSON.stringify(this.doc, null, 2) + "\n";
    // The file is taken now: a write queued before a workspace switch still goes to its own file.
    const file = this.file;
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(dirname(file), { recursive: true });
      const tmp = join(dirname(file), `.${basename(file)}.${process.pid}.tmp`);
      if (file === this.file) this.lastWrittenHash = sha(content);
      await writeFile(tmp, content, "utf8");
      await rename(tmp, file);
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
