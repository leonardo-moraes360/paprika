import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from "react";
import { InlineName } from "./InlineName";

export interface Workspace {
  id: string;
  name: string;
  nodes: number;
  updatedAt: number;
  active: boolean;
  /** URL of the cover image, or null: the card shows the first letter of the name. */
  cover: string | null;
}

/** Same limit as the server; bigger images are scaled down in the browser first. */
const MAX_COVER_BYTES = 2 * 1024 * 1024;
const COVER_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** The image as the server takes it: as is when small enough, else scaled to 960px wide as WebP. */
async function coverBody(file: File): Promise<Blob> {
  if (file.size <= MAX_COVER_BYTES && COVER_TYPES.includes(file.type)) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 960 / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/webp", 0.85));
  if (!blob) throw new Error("não foi possível converter a imagem");
  return blob;
}

const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });

/** "agora", "há 5 minutos", "ontem"… */
export function relativeTime(at: number, now = Date.now()): string {
  const s = Math.round((at - now) / 1000);
  const abs = Math.abs(s);
  if (abs < 45) return "agora";
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(s / 3600), "hour");
  if (abs < 30 * 86_400) return rtf.format(Math.round(s / 86_400), "day");
  return new Date(at).toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" });
}

/** Hue of the card's tile, stable per workspace (around the brand's warm and cool accents). */
function hue(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return [12, 24, 188, 200, 130, 340][h % 6]!;
}

interface Props {
  connected: boolean;
  /** Id of the active workspace (from the live connection); a change refreshes the list. */
  activeId: string | null;
  version: number;
  onOpen: (id: string) => void;
}

/** Home page: the workspaces of this server; opening one goes to its canvas. */
export function Overview({ connected, activeId, version, onOpen }: Props) {
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  /** One click selects a card; a double click opens it (on the name: renames). */
  const [selected, setSelected] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Workspace | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  /** Workspace whose cover the file picker is choosing. */
  const coverFor = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/workspaces");
      const body = (await res.json()) as { workspaces?: Workspace[]; error?: string };
      if (!res.ok || !body.workspaces) throw new Error(body.error ?? res.statusText);
      setWorkspaces(body.workspaces);
      setError(null);
    } catch (e) {
      setError(`Não foi possível listar os workspaces: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  // Refresh when the active workspace changes or someone (an agent) writes to it.
  useEffect(() => {
    void load();
  }, [load, activeId, version]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const body = (await res.json()) as { workspace?: Workspace; error?: string };
      if (!res.ok || !body.workspace) throw new Error(body.error ?? res.statusText);
      setName("");
      setCreating(false);
      onOpen(body.workspace.id);
    } catch (err) {
      setError(`Não foi possível criar o workspace: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const count = workspaces?.length ?? 0;

  const rename = async (w: Workspace, next: string) => {
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(w.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: next }),
      });
      const body = (await res.json()) as { workspace?: Workspace; error?: string };
      if (!res.ok || !body.workspace) throw new Error(body.error ?? res.statusText);
      setError(null);
    } catch (err) {
      setError(`Não foi possível renomear o workspace: ${err instanceof Error ? err.message : String(err)}`);
    }
    await load();
  };

  const setCover = async (id: string, file: File | null) => {
    try {
      const url = `/api/workspaces/${encodeURIComponent(id)}/cover`;
      const res = file ? await fetch(url, { method: "PUT", body: await coverBody(file) }) : await fetch(url, { method: "DELETE" });
      const body = (await res.json()) as { workspace?: Workspace; error?: string };
      if (!res.ok || !body.workspace) throw new Error(body.error ?? res.statusText);
      setError(null);
    } catch (err) {
      setError(`Não foi possível ${file ? "trocar" : "remover"} a capa: ${err instanceof Error ? err.message : String(err)}`);
    }
    await load();
  };

  const pickCover = (id: string) => {
    coverFor.current = id;
    coverInput.current?.click();
  };

  const askDelete = (w: Workspace) => {
    setDeleting(w);
    dialog.current?.showModal();
  };

  const confirmDelete = async () => {
    const w = deleting;
    dialog.current?.close();
    if (!w) return;
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(w.id)}`, { method: "DELETE" });
      const body = (await res.json()) as { deleted?: string; error?: string };
      if (!res.ok || !body.deleted) throw new Error(body.error ?? res.statusText);
      setError(null);
      if (selected === w.id) setSelected(null);
    } catch (err) {
      setError(`Não foi possível excluir o workspace: ${err instanceof Error ? err.message : String(err)}`);
    }
    await load();
  };

  const onCardKey = (e: KeyboardEvent, w: Workspace) => {
    if (e.key === "Enter") onOpen(w.id);
    else if (e.key === "F2") setRenaming(w.id);
    else if ((e.key === "Delete" || e.key === "Backspace") && count > 1) askDelete(w);
    else return;
    e.preventDefault();
  };

  /** Where the canvas and the agents go when the active workspace is deleted (the list is most recent first). */
  const successor = deleting?.active ? workspaces?.find((w) => w.id !== deleting.id) : undefined;
  return (
    <div className="overview">
      <header className="topbar">
        <div className="brand">
          <img className="logo" src="/icon.svg" alt="" />
          <strong>Paprika</strong>
        </div>
        <div className="status">
          <span className={`dot ${connected ? "on" : "off"}`} />
          <span className="muted">{connected ? "MCP em /mcp" : "desconectado"}</span>
        </div>
      </header>
      <main className="overview-main">
        <div className="overview-head">
          <div>
            <h1>Workspaces</h1>
            <p className="muted">
              {workspaces ? `${count} ${count === 1 ? "workspace" : "workspaces"} neste servidor.` : "Carregando…"} O ativo é o que os agentes
              enxergam pelo MCP. Clique duplo abre; clique duplo no nome renomeia.
            </p>
          </div>
          {creating ? (
            <form className="overview-new" onSubmit={create}>
              <input
                autoFocus
                aria-label="Nome do workspace"
                placeholder="Nome do workspace"
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setCreating(false)}
              />
              <button type="submit" className="primary" disabled={busy}>
                Criar
              </button>
              <button type="button" onClick={() => setCreating(false)}>
                Cancelar
              </button>
            </form>
          ) : (
            <button className="primary" onClick={() => setCreating(true)}>
              + Novo workspace
            </button>
          )}
        </div>
        {error && (
          <div className="overview-error" role="alert">
            {error}
          </div>
        )}
        <ul className="workspace-grid" aria-label="Workspaces">
          {workspaces?.map((w) => (
            <li key={w.id}>
              <div
                role="button"
                tabIndex={0}
                aria-pressed={selected === w.id}
                aria-label={`Workspace ${w.name}`}
                className={`workspace-card${w.active ? " is-active" : ""}${selected === w.id ? " is-selected" : ""}`}
                onClick={() => setSelected(w.id)}
                onDoubleClick={() => renaming !== w.id && onOpen(w.id)}
                onKeyDown={(e) => e.target === e.currentTarget && onCardKey(e, w)}
                onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
                onDrop={(e) => {
                  const file = e.dataTransfer.files[0];
                  if (!file?.type.startsWith("image/")) return;
                  e.preventDefault();
                  void setCover(w.id, file);
                }}
                data-workspace-id={w.id}
              >
                <span className="workspace-tile" style={{ "--tile-hue": hue(w.id) } as CSSProperties} aria-hidden>
                  {w.cover ? <img className="workspace-cover" src={w.cover} alt="" draggable={false} /> : (w.name.trim()[0] ?? "?").toUpperCase()}
                </span>
                <span className="workspace-info">
                  {renaming === w.id ? (
                    <InlineName
                      className="workspace-rename"
                      label="Novo nome do workspace"
                      value={w.name}
                      maxLength={120}
                      onCommit={(next) => void rename(w, next)}
                      onDone={() => setRenaming(null)}
                    />
                  ) : (
                    <span
                      className="workspace-name"
                      title="Clique duplo para renomear"
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setSelected(w.id);
                        setRenaming(w.id);
                      }}
                    >
                      {w.name}
                    </span>
                  )}
                  <span className="muted">
                    {w.nodes} {w.nodes === 1 ? "nó" : "nós"} · {relativeTime(w.updatedAt)}
                  </span>
                </span>
                {w.active && (
                  <span className="workspace-badge" title="Aberto no servidor: os agentes MCP leem e escrevem neste">
                    ativo
                  </span>
                )}
              </div>
              {renaming !== w.id && (
                <span className="workspace-actions">
                  <button type="button" className="icon-btn" aria-label={`Renomear ${w.name}`} title="Renomear (F2)" onClick={() => setRenaming(w.id)}>
                    ✎
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`${w.cover ? "Trocar" : "Adicionar"} capa de ${w.name}`}
                    title={`${w.cover ? "Trocar" : "Adicionar"} capa (ou arraste uma imagem para o card)`}
                    onClick={() => pickCover(w.id)}
                  >
                    🖼
                  </button>
                  {w.cover && (
                    <button type="button" className="icon-btn" aria-label={`Remover capa de ${w.name}`} title="Remover capa" onClick={() => void setCover(w.id, null)}>
                      ⊘
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Excluir ${w.name}`}
                    title={count > 1 ? "Excluir (Delete)" : "O único workspace não pode ser excluído"}
                    disabled={count <= 1}
                    onClick={() => askDelete(w)}
                  >
                    🗑
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
        <input
          ref={coverInput}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          aria-label="Imagem de capa"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (file && coverFor.current) void setCover(coverFor.current, file);
          }}
        />
        <dialog ref={dialog} className="workspace-dialog" aria-labelledby="delete-title" onClose={() => setDeleting(null)}>
          {deleting && (
            <form method="dialog" onSubmit={(e) => e.preventDefault()}>
              <h2 id="delete-title">Excluir “{deleting.name}”?</h2>
              <p>
                {deleting.nodes} {deleting.nodes === 1 ? "nó" : "nós"} e o histórico de desfazer serão apagados. Essa ação não pode ser desfeita.
              </p>
              {deleting.active && successor && (
                <p>
                  Este é o workspace ativo: o canvas e os agentes MCP passam para “{successor.name}”.
                </p>
              )}
              <div className="workspace-dialog-actions">
                <button type="button" onClick={() => dialog.current?.close()}>
                  Cancelar
                </button>
                <button type="button" className="danger" onClick={() => void confirmDelete()}>
                  Excluir
                </button>
              </div>
            </form>
          )}
        </dialog>
      </main>
    </div>
  );
}
