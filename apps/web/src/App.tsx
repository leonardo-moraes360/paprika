import { useEffect, useRef, useState, type CSSProperties } from "react";
import { firstPage, groupOps, isContainer, isScene, newId, ungroupOps, type ConnectorEnd, type Document, type NodeInput, type Op } from "@paprika/core";
import { Canvas, type Tool } from "./Canvas";
import { Inspector } from "./Inspector";
import { Layers } from "./Layers";
import { Pages } from "./Pages";
import { LEFT_PANEL, PanelResizer, RIGHT_PANEL, usePanelWidth } from "./PanelResizer";
import { api, errorText } from "./api";
import { Overview } from "./Overview";
import { navigate, parseRoute, useRoute, workspacePath } from "./route";
import { useDocument, type LiveDocument } from "./useDocument";
import { bar, cx } from "./ui";
import { openWorkspace } from "./workspaces";

// Plain class names next to utilities ("left", "right", "doc-name", "is-active") are hooks for the E2E suite.
const boot = "grid h-full place-content-center justify-items-center gap-3 text-muted";
const toast = "absolute bottom-4 left-1/2 max-w-[70%] -translate-x-1/2 cursor-pointer rounded-lg border border-accent bg-toast px-3 py-2 text-accent-pale";
const toolSep = "mx-1.5 h-5 w-px bg-line";
const toolButton = (active: boolean) =>
  cx(
    "h-[30px] w-8 cursor-pointer rounded-md border-0 text-lg enabled:hover:bg-panel-2 disabled:cursor-default disabled:opacity-35",
    active ? "is-active bg-accent text-white" : "bg-transparent",
  );

const TOOLS: { tool: Tool; key: string; label: string; icon: string }[] = [
  { tool: "select", key: "v", label: "Selecionar", icon: "↖" },
  { tool: "frame", key: "f", label: "Frame", icon: "#" },
  { tool: "rect", key: "r", label: "Retângulo", icon: "▭" },
  { tool: "ellipse", key: "o", label: "Elipse", icon: "◯" },
  { tool: "text", key: "t", label: "Texto", icon: "T" },
  { tool: "pen", key: "p", label: "Caneta (bezier)", icon: "✒" },
  { tool: "shape", key: "s", label: "Caixa de diagrama", icon: "▢" },
  { tool: "diamond", key: "d", label: "Decisão (losango)", icon: "◇" },
  { tool: "note", key: "n", label: "Nota adesiva", icon: "🗒" },
  { tool: "connector", key: "a", label: "Seta (prende nas formas)", icon: "↗" },
];

/** Converte uma subárvore em NodeInput com ids novos (para duplicar). */
function toInput(doc: Document, id: string): NodeInput {
  const n = doc.nodes[id]!;
  const { id: _id, parentId: _p, ...rest } = n as Record<string, unknown> & { id: string; parentId: string | null };
  const input: NodeInput = { ...(rest as Omit<NodeInput, "id">), type: n.type, id: newId() };
  if (isContainer(n)) input.children = n.children.map((c) => toInput(doc, c));
  else delete input.children;
  // A caixa de um grupo segue os filhos: não vai na criação.
  if (n.type === "group") {
    delete input.width;
    delete input.height;
  }
  // A geometria de um conector é derivada das pontas.
  if (n.type === "connector") for (const k of ["x", "y", "width", "height", "d"]) delete (input as Record<string, unknown>)[k];
  return input;
}

const siblingsOf = (doc: Document, parentId: string | null) => {
  const p = parentId ? doc.nodes[parentId] : undefined;
  return isContainer(p) ? p.children : doc.rootIds;
};

/**
 * `/` lists the workspaces; `/w/<id>` opens one on the canvas. The server has one active
 * workspace, shared with the MCP agents: opening a URL makes it active, and when someone else
 * (an agent) switches, the canvas follows and the URL is updated.
 */
export function App() {
  const live = useDocument();
  const route = useRoute();
  const routeId = route.view === "canvas" ? route.id : null;
  const activeId = live.doc?.id ?? null;
  // The workspace this tab asked the server to open and is still waiting for.
  const pending = useRef<string | null>(null);
  const { showError } = live;

  useEffect(() => {
    if (!routeId) return;
    pending.current = routeId;
    openWorkspace(routeId).catch((e: unknown) => {
      // pending stays set: a doc that arrives meanwhile must not send the URL to the active workspace.
      navigate("/", { replace: true });
      showError(`Não foi possível abrir o workspace: ${errorText(e)}`);
    });
  }, [routeId, showError]);

  useEffect(() => {
    // The URL is checked too: this effect can run after a navigation it has not rendered yet.
    if (!routeId || !activeId || parseRoute(location.pathname).view !== "canvas") return;
    if (activeId === routeId) pending.current = null;
    else if (pending.current !== routeId) navigate(workspacePath(activeId), { replace: true });
  }, [routeId, activeId]);

  useEffect(() => {
    if (!routeId) document.title = "Workspaces · Paprika";
  }, [routeId]);

  if (!routeId) {
    return (
      <>
        <Overview connected={live.connected} activeId={activeId} version={live.version} onOpen={(id) => navigate(workspacePath(id))} />
        {live.error && (
          <div className={toast} role="alert" onClick={live.clearError}>
            {live.error}
          </div>
        )}
      </>
    );
  }
  if (!live.doc || activeId !== routeId) {
    return (
      <div className={boot}>
        <img className="inline-block size-14 flex-none" src="/icon.svg" alt="" />
        <p>{live.connected ? "Abrindo workspace…" : "Conectando ao servidor Paprika…"}</p>
      </div>
    );
  }
  // key: another workspace starts with a clean selection, page and tool.
  return <Editor key={activeId} live={live} />;
}

function Editor({ live }: { live: LiveDocument }) {
  const { doc } = live;
  const [selected, setSelected] = useState<string[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [pageChoice, setPageChoice] = useState<string | null>(null);
  const [leftWidth, setLeftWidth] = usePanelWidth("paprika.panel.left", LEFT_PANEL);
  const [rightWidth, setRightWidth] = usePanelWidth("paprika.panel.right", RIGHT_PANEL);
  // Página ativa: a escolhida, se ainda existe; senão a primeira (null num documento sem páginas).
  const pageId = doc ? (pageChoice && doc.nodes[pageChoice]?.type === "page" ? pageChoice : (firstPage(doc)?.id ?? null)) : null;

  // Tira da seleção só os nós que deixaram de existir (não os que ainda estão a caminho do servidor).
  const prevDoc = useRef(doc);
  useEffect(() => {
    const gone = selected.filter((id) => doc && prevDoc.current?.nodes[id] && !doc.nodes[id]);
    if (gone.length) setSelected(selected.filter((id) => !gone.includes(id)));
    prevDoc.current = doc;
  }, [doc, selected]);

  const openPage = (id: string | null) => {
    setPageChoice(id);
    setSelected([]);
  };

  useEffect(() => {
    if (doc) document.title = `${doc.name} · Paprika`;
  }, [doc?.name]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) live.redo();
        else live.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        live.redo();
        return;
      }
      if (!doc) return;
      const nodes = selected.map((id) => doc.nodes[id]).filter(isScene);
      const key = e.key.toLowerCase();
      if (mod && key === "a") {
        e.preventDefault();
        // Todos os irmãos da seleção atual, ou os nós de topo da página.
        const parent = nodes[0]?.parentId ?? pageId;
        setSelected([...siblingsOf(doc, parent)]);
        return;
      }
      if (mod && key === "g" && nodes.length) {
        e.preventDefault();
        try {
          if (e.shiftKey) {
            const groups = nodes.filter((n) => n.type === "group").map((n) => n.id);
            if (!groups.length) return;
            const { released } = ungroupOps(doc, groups); // valida antes de enviar
            live.apply([{ op: "ungroup", ids: groups }], "desagrupar");
            setSelected(released);
          } else {
            const ids = nodes.map((n) => n.id);
            groupOps(doc, ids); // valida antes de enviar; o servidor expande contra o documento atual
            const id = newId();
            live.apply([{ op: "group", ids, id }], "agrupar");
            setSelected([id]);
          }
        } catch (err) {
          live.showError(err instanceof Error ? err.message : String(err));
        }
        return;
      }
      if (mod && key === "d" && nodes.length) {
        e.preventDefault();
        const ops: Op[] = [];
        const ids: string[] = [];
        // Do último para o primeiro, para os índices de inserção continuarem válidos.
        for (const node of [...nodes].reverse()) {
          const input = toInput(doc, node.id);
          if (node.type === "connector") {
            // Pontas livres andam 20; pontas presas continuam nas mesmas formas.
            const shift = (end: ConnectorEnd): ConnectorEnd => (end.nodeId ? end : { ...end, x: (end.x ?? 0) + 20, y: (end.y ?? 0) + 20 });
            Object.assign(input, { from: shift(node.from), to: shift(node.to) });
          } else {
            input.x = node.x + 20;
            input.y = node.y + 20;
          }
          ops.push({ op: "create", node: input, parentId: node.parentId, index: siblingsOf(doc, node.parentId).indexOf(node.id) + 1 });
          ids.unshift(input.id!);
        }
        live.apply(ops, "duplicar");
        setSelected(ids);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && nodes.length) {
        e.preventDefault();
        // Um nó cujo ancestral também será apagado já sai junto com ele.
        const set = new Set(nodes.map((n) => n.id));
        const under = (id: string) => {
          for (let p = doc.nodes[id]?.parentId; p; p = doc.nodes[p]?.parentId ?? null) if (set.has(p)) return true;
          return false;
        };
        live.apply(nodes.filter((n) => !under(n.id)).map((n) => ({ op: "delete", id: n.id })), "apagar");
        setSelected([]);
        return;
      }
      if (e.key === "Escape") {
        setTool("select");
        const parent = nodes[0]?.parentId;
        setSelected(parent && doc.nodes[parent]?.type !== "page" ? [parent] : []);
        return;
      }
      if (nodes.length && e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key] ?? [0, 0];
        const ops: Op[] = nodes.filter((n) => !n.locked && n.type !== "connector").map((n) => ({ op: "update", id: n.id, props: { x: n.x + d[0]!, y: n.y + d[1]! } }));
        if (ops.length) live.apply(ops, "mover");
        return;
      }
      const t2 = TOOLS.find((x) => x.key === e.key.toLowerCase());
      if (t2 && !mod) setTool(t2.tool);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc, selected, pageId, live.apply, live.undo, live.redo, live.showError]);

  if (!doc) {
    return (
      <div className={boot}>
        <img className="inline-block size-14 flex-none" src="/icon.svg" alt="" />
        <p>{live.connected ? "Carregando workspace…" : "Conectando ao servidor Paprika…"}</p>
      </div>
    );
  }

  // O servidor mede o layout num navegador e devolve o SVG em JSON; o download é feito aqui.
  const exportSvg = async () => {
    const root = selected.length === 1 ? selected[0]! : (pageId ?? "");
    try {
      const body = await api<{ svg?: string; warnings?: string[] }>(`/api/svg${root ? `?root=${encodeURIComponent(root)}` : ""}`);
      if (!body.svg) throw new Error("o servidor não devolveu o SVG");
      const url = URL.createObjectURL(new Blob([body.svg], { type: "image/svg+xml" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(doc.nodes[root]?.name || doc.name || "paprika").replace(/[\\/:*?"<>|]+/g, "-")}.svg`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (body.warnings?.length) live.showError(`SVG exportado com avisos: ${body.warnings.join("; ")}`);
    } catch (err) {
      live.showError(`Falha ao exportar SVG: ${errorText(err)}`);
    }
  };

  const node = selected.length === 1 ? (doc.nodes[selected[0]!] ?? null) : null;
  const lastAgent = live.activity.find((a) => a.actor.startsWith("agent"));

  return (
    <div
      className={cx(
        "grid h-full grid-cols-[var(--left-w,240px)_minmax(0,1fr)_var(--right-w,280px)] grid-rows-[44px_1fr] [grid-template-areas:'top_top_top'_'left_center_right']",
        "max-wide:grid-cols-1 max-wide:grid-rows-[44px_1fr_220px] max-wide:[grid-template-areas:'top'_'center'_'right']",
      )}
      style={{ "--left-w": `${leftWidth}px`, "--right-w": `${rightWidth}px` } as CSSProperties}>
      <header className={cx(bar.topbar, "[grid-area:top]")}>
        <div className={bar.brand}>
          <a
            className="group/home flex items-center gap-2 rounded-md text-inherit no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-select"
            href="/"
            title="Todos os workspaces"
            onClick={(e) => {
              e.preventDefault();
              navigate("/");
            }}
          >
            <img className={bar.logo} src="/icon.svg" alt="" />
            <strong className="group-hover/home:text-accent-ink">Paprika</strong>
          </a>
          <span className="text-line" aria-hidden>
            /
          </span>
          <span className="doc-name truncate text-muted max-wide:hidden">{doc.name}</span>
        </div>
        <div className={bar.status}>
          {lastAgent && Date.now() - lastAgent.at < 8000 && (
            <span className="agent-pill max-w-[280px] truncate rounded-full bg-accent-soft px-2 py-0.75 text-accent-ink">🤖 {lastAgent.label}</span>
          )}
          <span className={bar.dot(live.connected)} />
          <span className={bar.statusText}>{live.connected ? `v${live.version} · MCP em /mcp` : "desconectado"}</span>
        </div>
      </header>
      <aside className="left overflow-auto border-r border-line bg-panel [grid-area:left] max-wide:hidden">
        <Pages doc={doc} pageId={pageId} onOpen={openPage} apply={live.apply} />
        <Layers doc={doc} pageId={pageId} selected={selected} onSelect={setSelected} apply={live.apply} />
      </aside>
      <PanelResizer side="left" label="Largura do painel de camadas" width={leftWidth} limits={LEFT_PANEL} onChange={setLeftWidth} />
      <main className="relative overflow-hidden [grid-area:center]">
        {/* Floating toolbar, centered at the top of the canvas. */}
        <nav className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border border-line bg-panel p-1 shadow-float" aria-label="Ferramentas" onPointerDown={(e) => e.stopPropagation()}>
          {TOOLS.map((t) => (
            <button
              key={t.tool}
              className={toolButton(tool === t.tool)}
              onClick={() => setTool(t.tool)}
              title={`${t.label} (${t.key.toUpperCase()})`}
              aria-pressed={tool === t.tool}
              aria-label={t.label}
            >
              {t.icon}
            </button>
          ))}
          <span className={toolSep} />
          <button className={toolButton(false)} onClick={live.undo} disabled={!live.canUndo} title="Desfazer (Ctrl+Z)" aria-label="Desfazer">
            ↶
          </button>
          <button className={toolButton(false)} onClick={live.redo} disabled={!live.canRedo} title="Refazer (Ctrl+Shift+Z)" aria-label="Refazer">
            ↷
          </button>
          <span className={toolSep} />
          <button className={toolButton(false)} onClick={exportSvg} title="Exportar SVG (seleção, ou a página)" aria-label="Exportar SVG">
            ⇩
          </button>
        </nav>
        <Canvas
          doc={doc}
          selected={selected}
          onSelect={setSelected}
          pageId={pageId}
          tool={tool}
          onToolDone={() => setTool("select")}
          apply={live.apply}
          agentTouched={live.agentTouched}
          agents={live.agents}
          onError={live.showError}
        />
        {live.error && (
          <div className={toast} role="alert" onClick={live.clearError}>
            {live.error}
          </div>
        )}
      </main>
      <PanelResizer side="right" label="Largura do painel de propriedades" width={rightWidth} limits={RIGHT_PANEL} onChange={setRightWidth} />
      <aside className="right overflow-auto border-l border-line bg-panel [grid-area:right] max-wide:border-t max-wide:border-l-0">
        <Inspector
          doc={doc}
          node={node}
          selected={selected}
          apply={live.apply}
          activity={live.activity}
          onSelect={(id) => {
            // Um nó de outra página (ex.: um item da revisão) abre a página dele.
            let top = doc.nodes[id];
            while (top?.parentId) top = doc.nodes[top.parentId];
            if (top?.type === "page" && top.id !== pageId) setPageChoice(top.id);
            setSelected([id]);
          }}
          onSelectMany={setSelected}
          onError={live.showError}
        />
      </aside>
    </div>
  );
}
