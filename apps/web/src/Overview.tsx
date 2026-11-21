import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { bar, cx } from "./ui";

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

/** The tile's letter and glow follow the workspace hue. */
const tile = (h: number): CSSProperties => ({
  color: `hsl(${h} 70% 78%)`,
  background: `radial-gradient(circle at 30% 20%, hsl(${h} 60% 40% / 0.55), transparent 60%), linear-gradient(160deg, var(--color-panel-2), var(--color-night))`,
});

const button = (primary: boolean) =>
  cx(
    "cursor-pointer rounded-lg border px-3.5 py-1.75 disabled:cursor-default disabled:opacity-60",
    primary ? "border-accent bg-accent font-semibold text-white" : "border-line bg-panel",
  );

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
    <div className="grid h-full grid-rows-[44px_1fr]">
      <header className={bar.topbar}>
        <div className={bar.brand}>
          <img className={bar.logo} src="/icon.svg" alt="" />
          <strong>Paprika</strong>
        </div>
        <div className={bar.status}>
          <span className={bar.dot(connected)} />
          <span className={bar.statusText}>{connected ? "MCP em /mcp" : "desconectado"}</span>
        </div>
      </header>
      <main className="min-h-0 overflow-auto px-6 pt-8 pb-12 *:mx-auto *:max-w-[1080px]">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="mx-0 mt-0 mb-1.5 text-xl font-[650]">Workspaces</h1>
            <p className="m-0 text-muted">
              {workspaces ? `${count} ${count === 1 ? "workspace" : "workspaces"} neste servidor.` : "Carregando…"} O ativo é o que os agentes
              enxergam pelo MCP.
            </p>
          </div>
          {creating ? (
            <form className="flex gap-2" onSubmit={create}>
              <input
                className="w-60 max-w-[50vw] rounded-lg border border-line bg-panel-2 px-2.5 py-1.75 focus:outline-2 focus:-outline-offset-1 focus:outline-select"
                autoFocus
                aria-label="Nome do workspace"
                placeholder="Nome do workspace"
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setCreating(false)}
              />
              <button type="submit" className={button(true)} disabled={busy}>
                Criar
              </button>
              <button type="button" className={button(false)} onClick={() => setCreating(false)}>
                Cancelar
              </button>
            </form>
          ) : (
            <button className={button(true)} onClick={() => setCreating(true)}>
              + Novo workspace
            </button>
          )}
        </div>
        {error && (
          <div className="mb-4 rounded-lg bg-accent-soft px-3 py-2.5 text-accent-ink" role="alert">
            {error}
          </div>
        )}
        <ul className="grid list-none grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4 p-0" aria-label="Workspaces">
          {workspaces?.map((w) => (
            <li key={w.id}>
              <button
                className={cx(
                  // "workspace-card" and "is-active" stay as hooks for the E2E suite.
                  "workspace-card relative flex w-full cursor-pointer flex-col overflow-hidden rounded-xl border bg-panel p-0 text-left",
                  "transition-[border-color,translate] duration-120 hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-select",
                  w.active ? "is-active border-accent" : "border-line hover:border-muted",
                )}
                onClick={() => onOpen(w.id)} data-workspace-id={w.id}>
                <span className="grid h-32 place-items-center border-b border-line text-tile font-bold" style={tile(hue(w.id))} aria-hidden>
                  {(w.name.trim()[0] ?? "?").toUpperCase()}
                </span>
                <span className="grid min-w-0 gap-1 px-3.5 pt-3 pb-3.5">
                  <span className="truncate text-md font-semibold">{w.name}</span>
                  <span className="text-muted">
                    {w.nodes} {w.nodes === 1 ? "nó" : "nós"} · {relativeTime(w.updatedAt)}
                  </span>
                </span>
                {w.active && (
                  <span className="absolute top-2.5 right-2.5 rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-white" title="Aberto no servidor: os agentes MCP leem e escrevem neste">
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
