import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react";

export interface Workspace {
  id: string;
  name: string;
  nodes: number;
  updatedAt: number;
  active: boolean;
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
              enxergam pelo MCP.
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
              <button className={`workspace-card${w.active ? " is-active" : ""}`} onClick={() => onOpen(w.id)} data-workspace-id={w.id}>
                <span className="workspace-tile" style={{ "--tile-hue": hue(w.id) } as CSSProperties} aria-hidden>
                  {(w.name.trim()[0] ?? "?").toUpperCase()}
                </span>
                <span className="workspace-info">
                  <span className="workspace-name">{w.name}</span>
                  <span className="muted">
                    {w.nodes} {w.nodes === 1 ? "nó" : "nós"} · {relativeTime(w.updatedAt)}
                  </span>
                </span>
                {w.active && (
                  <span className="workspace-badge" title="Aberto no servidor: os agentes MCP leem e escrevem neste">
                    ativo
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
