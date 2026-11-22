import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Bot, Circle, Diamond, Download, Frame, MousePointer2, MoveUpRight, PenTool, RectangleHorizontal, Redo2, Square, StickyNote, Triangle, Type, Undo2, type LucideIcon } from "lucide-react";
import { firstPage, groupOps, isContainer, isScene, newId, ungroupOps, type ConnectorEnd, type Document, type NodeInput, type Op } from "@paprika/core";
import { Canvas, type Tool } from "./Canvas";
import { Inspector } from "./Inspector";
import { InviteDialog, JoinDialog, KeysDialog, TeamChip, TeamPanel } from "./Team";
import { Layers } from "./Layers";
import { Pages } from "./Pages";
import { LEFT_PANEL, PanelResizer, PanelToggle, RIGHT_PANEL, usePanel } from "./PanelResizer";
import { api, errorText } from "./api";
import { ConnectionStatus } from "./ConnectionStatus";
import { Overview } from "./Overview";
import { navigate, parseRoute, useRoute, workspacePath } from "./route";
import { useLive, useLiveActions, useLiveConnection } from "./useDocument";
import { Button } from "./components/ui/button";
import { Separator } from "./components/ui/separator";
import { statusDotVariants } from "./components/ui/status";
import { Tabs, TabsList, TabsTrigger } from "./components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "./components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/ui/tooltip";
import { cn } from "./lib/cn";
import { bar } from "./ui";
import { openWorkspace } from "./workspaces";
import { WorkspaceNotice } from "./WorkspaceNotice";

const boot = "grid h-full place-content-center justify-items-center gap-3 text-ui-muted-foreground";
const toast = "absolute bottom-4 left-1/2 max-w-[70%] -translate-x-1/2 cursor-pointer rounded-lg border border-accent bg-toast px-3 py-2 text-accent-pale";
const toolItemClass =
  "h-[30px] w-8 shrink-0 rounded-md border-0 bg-transparent p-0 text-ui-foreground hover:bg-ui-secondary hover:text-ui-foreground data-[state=on]:bg-accent-strong data-[state=on]:text-white data-[state=on]:hover:bg-accent-strong data-[state=on]:hover:text-white [&_svg]:size-[18px]";
const actionItemClass =
  "inline-flex h-[30px] w-8 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-ui-foreground hover:bg-ui-secondary disabled:cursor-default disabled:opacity-35 [&_svg]:size-[18px]";

/** Lucide icon size in the floating toolbar, in px. */
const TOOL_ICON = 18;

const TOOLS: { tool: Tool; key: string; label: string; icon: LucideIcon }[] = [
  { tool: "select", key: "v", label: "Selecionar", icon: MousePointer2 },
  { tool: "frame", key: "f", label: "Frame", icon: Frame },
  { tool: "rect", key: "r", label: "Retângulo", icon: RectangleHorizontal },
  { tool: "ellipse", key: "o", label: "Elipse", icon: Circle },
  { tool: "text", key: "t", label: "Texto", icon: Type },
  { tool: "pen", key: "p", label: "Caneta (bezier)", icon: PenTool },
  { tool: "shape", key: "s", label: "Caixa de diagrama", icon: Square },
  { tool: "diamond", key: "d", label: "Decisão (losango)", icon: Diamond },
  { tool: "triangle", key: "g", label: "Triângulo", icon: Triangle },
  { tool: "note", key: "n", label: "Nota adesiva", icon: StickyNote },
  { tool: "connector", key: "a", label: "Seta (prende nas formas)", icon: MoveUpRight },
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
  useLiveConnection();
  // App subscribes to the active workspace id and the connection only: the document, presence and
  // activity are read by the components that draw them (useLive), so an agent's presence message
  // does not re-render the editor.
  const activeId = useLive((s) => s.doc?.id ?? null);
  const connected = useLive((s) => s.connected);
  const { showError } = useLiveActions();
  const route = useRoute();
  const routeId = route.view === "canvas" ? route.id : null;
  // The workspace this tab asked the server to open and is still waiting for.
  const pending = useRef<string | null>(null);

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
        <OverviewRoute activeId={activeId} connected={connected} />
        <ErrorToast />
        <WorkspaceNotice />
      </>
    );
  }
  if (!activeId || activeId !== routeId) {
    return (
      <div className={boot}>
        <img className="inline-block size-14 flex-none" src="/icon.svg" alt="" />
        <p>{connected ? "Abrindo workspace…" : "Conectando ao servidor Paprika…"}</p>
      </div>
    );
  }
  // key: another workspace starts with a clean selection, page and tool.
  return <Editor key={activeId} />;
}

/** The overview refreshes on every committed version, so the version is read here, not in App. */
function OverviewRoute({ activeId, connected }: { activeId: string | null; connected: boolean }) {
  const version = useLive((s) => s.version);
  return <Overview connected={connected} activeId={activeId} version={version} onOpen={(id) => navigate(workspacePath(id))} />;
}

function ErrorToast() {
  const error = useLive((s) => s.error);
  const { clearError } = useLiveActions();
  if (!error) return null;
  return (
    <div className={toast} role="alert" onClick={clearError}>
      {error}
    </div>
  );
}

/** The team panel is the other reader of agent presence (besides the cursors on the canvas). */
function LiveTeamPanel(props: Omit<Parameters<typeof TeamPanel>[0], "agents">) {
  const agents = useLive((s) => s.agents);
  return <TeamPanel {...props} agents={agents} />;
}

function Editor() {
  const doc = useLive((s) => s.doc);
  const connected = useLive((s) => s.connected);
  const version = useLive((s) => s.version);
  const canUndo = useLive((s) => s.canUndo);
  const canRedo = useLive((s) => s.canRedo);
  const activity = useLive((s) => s.activity);
  const agentTouched = useLive((s) => s.agentTouched);
  const team = useLive((s) => s.team);
  const actions = useLiveActions();
  const live = { ...actions, connected, version, canUndo, canRedo, activity, agentTouched, team };
  const [selected, setSelected] = useState<string[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [pageChoice, setPageChoice] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<"inspector" | "team">("inspector");
  const [teamDialog, setTeamDialog] = useState<"invite" | "join" | "keys" | null>(null);
  const leftPanel = usePanel("paprika.panel.left", LEFT_PANEL);
  const rightPanel = usePanel("paprika.panel.right", RIGHT_PANEL);
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
        const t = e.target;
        if (t instanceof Element && t.closest('[data-slot="popover-content"], [data-slot="dialog-content"], [role="dialog"], [role="alertdialog"]')) return;
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
      className={cn(
        "grid h-full grid-cols-[var(--left-w,240px)_minmax(0,1fr)_var(--right-w,280px)] grid-rows-[44px_1fr] [grid-template-areas:'top_top_top'_'left_center_right']",
        "max-wide:grid-cols-1 max-wide:grid-rows-[44px_1fr_220px] max-wide:[grid-template-areas:'top'_'center'_'right']",
      )}
      style={{ "--left-w": `${leftPanel.collapsed ? 0 : leftPanel.width}px`, "--right-w": `${rightPanel.collapsed ? 0 : rightPanel.width}px` } as CSSProperties}>
      <header className={cn(bar.topbar, "border-ui-border bg-ui-card [grid-area:top]")}>
        <div className={bar.brand}>
          <a
            className="group/home flex items-center gap-2 rounded-md text-inherit no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-ring"
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
          <span className="text-ui-border" aria-hidden>
            /
          </span>
          <h1 className="doc-name m-0 truncate text-ui-muted-foreground [font:inherit] max-wide:sr-only">{doc.name}</h1>
        </div>
        <div className={bar.status}>
          {live.team !== undefined && <TeamChip status={live.team} onClick={() => setRightTab("team")} />}
          {lastAgent && Date.now() - lastAgent.at < 8000 && (
            <span className="agent-pill inline-flex max-w-[280px] items-center gap-1 rounded-full bg-accent-soft px-2 py-0.75 text-accent-ink">
              <Bot className="shrink-0" size={14} aria-hidden />
              <span className="truncate">{lastAgent.label}</span>
            </span>
          )}
          <span className={statusDotVariants({ tone: live.connected ? "ok" : "alert" })} aria-hidden />
          <span className={bar.statusText}>{live.connected ? `v${live.version} · MCP em /mcp` : "desconectado"}</span>
          <ConnectionStatus connected={live.connected} />
        </div>
      </header>
      <aside aria-label="Páginas e camadas" className={cn("left overflow-auto border-r border-ui-border bg-ui-card [grid-area:left] max-wide:hidden", leftPanel.collapsed && "hidden")}>
        <Pages doc={doc} pageId={pageId} onOpen={openPage} apply={live.apply} />
        <Layers doc={doc} pageId={pageId} selected={selected} onSelect={setSelected} apply={live.apply} />
      </aside>
      <PanelResizer side="left" label="Largura do painel de camadas" panel={leftPanel} limits={LEFT_PANEL} />
      <main className={cn("relative overflow-hidden [grid-area:center]", rightPanel.collapsed && "[&_[data-testid=agent-roster]]:top-14")}>
        {leftPanel.collapsed && <PanelToggle side="left" label="Mostrar painel de camadas" panel={leftPanel} />}
        {rightPanel.collapsed && <PanelToggle side="right" label="Mostrar painel de propriedades" panel={rightPanel} />}
        <TooltipProvider delayDuration={400}>
          <nav
            className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border border-ui-border bg-ui-card p-1 shadow-float"
            aria-label="Ferramentas"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <ToggleGroup
              type="multiple"
              rovingFocus={false}
              value={[tool]}
              onValueChange={(next) => {
                const added = next.find((v) => v !== tool);
                if (added) setTool(added as Tool);
              }}
              className="gap-0.5"
            >
              {TOOLS.map((t) => (
                <Tooltip key={t.tool}>
                  <TooltipTrigger asChild>
                    <ToggleGroupItem
                      value={t.tool}
                      className={cn(toolItemClass, tool === t.tool && "is-active")}
                      aria-label={t.label}
                    >
                      <t.icon size={TOOL_ICON} strokeWidth={1.75} aria-hidden />
                    </ToggleGroupItem>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{`${t.label} (${t.key.toUpperCase()})`}</TooltipContent>
                </Tooltip>
              ))}
            </ToggleGroup>
            <Separator orientation="vertical" className="mx-1.5 h-5" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" className={actionItemClass} onClick={live.undo} disabled={!live.canUndo} aria-label="Desfazer">
                  <Undo2 size={TOOL_ICON} strokeWidth={1.75} aria-hidden />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Desfazer (Ctrl+Z)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" className={actionItemClass} onClick={live.redo} disabled={!live.canRedo} aria-label="Refazer">
                  <Redo2 size={TOOL_ICON} strokeWidth={1.75} aria-hidden />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Refazer (Ctrl+Shift+Z)</TooltipContent>
            </Tooltip>
            <Separator orientation="vertical" className="mx-1.5 h-5" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" className={actionItemClass} onClick={exportSvg} aria-label="Exportar SVG">
                  <Download size={TOOL_ICON} strokeWidth={1.75} aria-hidden />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Exportar SVG (seleção, ou a página)</TooltipContent>
            </Tooltip>
          </nav>
        </TooltipProvider>
        <Canvas
          doc={doc}
          selected={selected}
          onSelect={setSelected}
          pageId={pageId}
          tool={tool}
          onToolDone={() => setTool("select")}
          apply={live.apply}
          agentTouched={live.agentTouched}
          onOpenPage={openPage}
          onError={live.showError}
        />
        <ErrorToast />
        <WorkspaceNotice />
      </main>
      <PanelResizer side="right" label="Largura do painel de propriedades" panel={rightPanel} limits={RIGHT_PANEL} />
      <aside aria-label="Propriedades" className={cn("right overflow-auto border-l border-ui-border bg-ui-card [grid-area:right] max-wide:border-t max-wide:border-l-0", rightPanel.collapsed && "hidden")}>
        {live.team !== undefined && (
          <Tabs
            value={rightTab}
            onValueChange={(v) => setRightTab(v as "inspector" | "team")}
            className="right-tabs m-3 mb-0 gap-0"
          >
            <TabsList className="grid h-auto w-full grid-cols-2 gap-0.5 rounded-md bg-night p-0.5" aria-label="Painel da direita">
              {(["inspector", "team"] as const).map((t) => (
                <TabsTrigger
                  key={t}
                  id={`right-tab-${t}`}
                  value={t}
                  aria-controls="right-tabpanel"
                  className={cn(
                    "rounded-sm py-1 text-xs data-[state=active]:bg-ui-secondary data-[state=active]:text-ui-foreground data-[state=active]:shadow-none",
                    rightTab === t && "is-active",
                  )}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") {
                      e.stopPropagation();
                    }
                  }}
                >
                  {t === "inspector" ? "Inspector" : "Time"}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
        <div id="right-tabpanel" role={live.team !== undefined ? "tabpanel" : undefined} aria-labelledby={live.team !== undefined ? `right-tab-${rightTab}` : undefined}>
        {live.team !== undefined && rightTab === "team" ? (
          <LiveTeamPanel
            status={live.team}
            docId={doc.id}
            onInvite={() => setTeamDialog("invite")}
            onJoin={() => setTeamDialog("join")}
            onKeys={() => setTeamDialog("keys")}
          />
        ) : (
        <Inspector
          doc={doc}
          node={node}
          selected={selected}
          apply={live.apply}
          activity={live.activity}
          onSelect={(id) => {
            let top = doc.nodes[id];
            while (top?.parentId) top = doc.nodes[top.parentId];
            if (top?.type === "page" && top.id !== pageId) setPageChoice(top.id);
            setSelected([id]);
          }}
          onSelectMany={setSelected}
          onError={live.showError}
        />
        )}
        </div>
      </aside>
      {teamDialog === "invite" && live.team && <InviteDialog status={live.team} onClose={() => setTeamDialog(null)} />}
      {teamDialog === "join" && <JoinDialog status={live.team ?? null} onClose={() => setTeamDialog(null)} />}
      {teamDialog === "keys" && live.team && <KeysDialog status={live.team} onClose={() => setTeamDialog(null)} onInvite={() => setTeamDialog("invite")} />}
    </div>
  );
}
