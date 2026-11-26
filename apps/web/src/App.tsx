import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Bot, Circle, Cloud, Crosshair, Cylinder, Diamond, Frame, MousePointer2, MoveUpRight, PenTool, RectangleHorizontal, Square, StickyNote, Triangle, Type, type LucideIcon } from "lucide-react";
import { centerContentOps, firstPage, groupOps, isContainer, isScene, newId, ungroupOps, wrapOps, type ConnectorEnd, type Document, type NodeInput, type Op } from "@paprika/core";
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
import { openWorkspace } from "./workspaces";
import { liveStore, useLive, useLiveActions, useLiveConnection } from "./useDocument";
import { statusDotVariants } from "./components/ui/status";
import { Tabs, TabsList, TabsTrigger } from "./components/ui/tabs";
import { Hint } from "./components/ui/tooltip";
import { cn } from "./lib/cn";
import { bar } from "./ui";
import { LanguageSwitcher, useT } from "./i18n";
import { HistoryPanel } from "./HistoryPanel";
import { isHistoryOpen, redoOwn, setHistoryOpen, undoOwn, useHistoryOpen } from "./historyActions";
import { pageOfNodes } from "./historyModel";
import { ToastHost } from "./components/ui/toast";
import { WorkspaceNotice } from "./WorkspaceNotice";
import { PinsChip } from "./Pins";
import { setPinsPanel } from "./pins";
import { captureParams } from "./capture";
import { readToolbarDock, Toolbar, type ToolbarDock } from "./Toolbar";

const boot = "grid h-full place-content-center justify-items-center gap-3 text-ui-muted-foreground";
const toast = "absolute bottom-4 left-1/2 max-w-[70%] -translate-x-1/2 cursor-pointer rounded-lg border border-accent bg-toast px-3 py-2 text-accent-pale";

const ParallelogramIcon = ((props: { className?: string }) => (
  <Square {...props} className={cn("-skew-x-12", props.className)} />
)) as LucideIcon;

const TOOL_DEFS: { tool: Tool; key: string; labelKey: keyof import("./i18n").Messages; icon: LucideIcon }[] = [
  { tool: "select", key: "v", labelKey: "toolSelect", icon: MousePointer2 },
  { tool: "frame", key: "f", labelKey: "toolFrame", icon: Frame },
  { tool: "rect", key: "r", labelKey: "toolRect", icon: RectangleHorizontal },
  { tool: "ellipse", key: "o", labelKey: "toolEllipse", icon: Circle },
  { tool: "text", key: "t", labelKey: "toolText", icon: Type },
  { tool: "pen", key: "p", labelKey: "toolPen", icon: PenTool },
  { tool: "shape", key: "s", labelKey: "toolShape", icon: Square },
  { tool: "diamond", key: "d", labelKey: "toolDiamond", icon: Diamond },
  { tool: "triangle", key: "g", labelKey: "toolTriangle", icon: Triangle },
  { tool: "cylinder", key: "c", labelKey: "toolCylinder", icon: Cylinder },
  { tool: "parallelogram", key: "b", labelKey: "toolParallelogram", icon: ParallelogramIcon },
  { tool: "cloud", key: "u", labelKey: "toolCloud", icon: Cloud },
  { tool: "note", key: "n", labelKey: "toolNote", icon: StickyNote },
  { tool: "connector", key: "a", labelKey: "toolConnector", icon: MoveUpRight },
  { tool: "pin", key: "i", labelKey: "toolPin", icon: Crosshair },
];

function toInput(doc: Document, id: string): NodeInput {
  const n = doc.nodes[id]!;
  const { id: _id, parentId: _p, ...rest } = n as Record<string, unknown> & { id: string; parentId: string | null };
  const input: NodeInput = { ...(rest as Omit<NodeInput, "id">), type: n.type, id: newId() };
  if (isContainer(n)) input.children = n.children.map((c) => toInput(doc, c));
  else delete input.children;
  if (n.type === "group") {
    delete input.width;
    delete input.height;
  }
  if (n.type === "connector") for (const k of ["x", "y", "width", "height", "d"]) delete (input as Record<string, unknown>)[k];
  return input;
}

const siblingsOf = (doc: Document, parentId: string | null) => {
  const p = parentId ? doc.nodes[parentId] : undefined;
  return isContainer(p) ? p.children : doc.rootIds;
};

export function App() {
  useLiveConnection();
  const m = useT();
  const activeId = useLive((s) => s.doc?.id ?? null);
  const connected = useLive((s) => s.connected);
  const { showError } = useLiveActions();
  const route = useRoute();
  const routeId = route.view === "canvas" ? route.id : null;
  useEffect(() => {
    let current = true;
    liveStore.view(routeId).catch((e: unknown) => {
      if (!current || !routeId) return;
      navigate("/", { replace: true });
      showError(m.openWorkspaceFail(errorText(e)));
    });
    return () => {
      current = false;
    };
  }, [routeId, showError, m]);

  useEffect(() => {
    liveStore.onViewDeleted = () => navigate("/", { replace: true });
    return () => {
      liveStore.onViewDeleted = null;
    };
  }, []);

  useEffect(() => {
    if (!routeId) document.title = m.workspacesTitle;
  }, [routeId, m]);

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
        <p>{connected ? m.openingWorkspace : m.connectingServer}</p>
      </div>
    );
  }
  return <Editor key={activeId} />;
}

function OverviewRoute({ activeId, connected }: { activeId: string | null; connected: boolean }) {
  const version = useLive((s) => s.version);
  const { showError } = useLiveActions();
  const m = useT();
  const onOpen = (id: string) => {
    navigate(workspacePath(id));
    openWorkspace(id).catch((e: unknown) => showError(m.openWorkspaceFail(errorText(e))));
  };
  return <Overview connected={connected} activeId={activeId} version={version} onOpen={onOpen} />;
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

function LiveTeamPanel(props: Omit<Parameters<typeof TeamPanel>[0], "agents">) {
  const agents = useLive((s) => s.agents);
  return <TeamPanel {...props} agents={agents} />;
}

function Editor() {
  const m = useT();
  const doc = useLive((s) => s.doc);
  const connected = useLive((s) => s.connected);
  const version = useLive((s) => s.version);
  const canUndo = useLive((s) => s.canUndo);
  const canRedo = useLive((s) => s.canRedo);
  const activity = useLive((s) => s.activity);
  const agentTouched = useLive((s) => s.agentTouched);
  const team = useLive((s) => s.team);
  const historyOpen = useHistoryOpen();
  const actions = useLiveActions();
  const live = { ...actions, connected, version, canUndo, canRedo, activity, agentTouched, team };
  const [selected, setSelected] = useState<string[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [pageChoice, setPageChoice] = useState<string | null>(() => captureParams()?.page ?? null);
  const [rightTab, setRightTab] = useState<"inspector" | "team">("inspector");
  const [teamDialog, setTeamDialog] = useState<"invite" | "join" | "keys" | null>(null);
  const leftPanel = usePanel("paprika.panel.left", LEFT_PANEL);
  const rightPanel = usePanel("paprika.panel.right", RIGHT_PANEL);
  const [toolbarDock, setToolbarDock] = useState<ToolbarDock>(() => readToolbarDock());
  const pageId = doc ? (pageChoice && doc.nodes[pageChoice]?.type === "page" ? pageChoice : (firstPage(doc)?.id ?? null)) : null;

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
    if (doc) document.title = m.documentTitle(doc.name);
  }, [doc?.name, m]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) void redoOwn();
        else void undoOwn();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        void redoOwn();
        return;
      }
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "h") {
        e.preventDefault();
        setHistoryOpen((v) => !v);
        return;
      }
      if (!doc) return;
      const nodes = selected.map((id) => doc.nodes[id]).filter(isScene);
      const key = e.key.toLowerCase();
      if (mod && key === "a") {
        e.preventDefault();
        const parent = nodes[0]?.parentId ?? pageId;
        setSelected([...siblingsOf(doc, parent)]);
        return;
      }
      if (mod && (key === "g" || e.code === "KeyG") && nodes.length) {
        e.preventDefault();
        try {
          if (e.altKey && !e.shiftKey) {
            const ids = nodes.map((n) => n.id);
            const id = newId();
            wrapOps(doc, ids);
            live.apply([{ op: "wrap", ids, id }], "envolver em frame");
            setSelected([id]);
          } else if (e.shiftKey && !e.altKey) {
            const groups = nodes.filter((n) => n.type === "group").map((n) => n.id);
            if (!groups.length) return;
            const { released } = ungroupOps(doc, groups);
            live.apply([{ op: "ungroup", ids: groups }], "desagrupar");
            setSelected(released);
          } else if (!e.altKey) {
            const ids = nodes.map((n) => n.id);
            groupOps(doc, ids);
            const id = newId();
            live.apply([{ op: "group", ids, id }], "agrupar");
            setSelected([id]);
          }
        } catch (err) {
          live.showError(err instanceof Error ? err.message : String(err));
        }
        return;
      }
      if (e.altKey && !mod && !e.shiftKey && e.code === "KeyC") {
        e.preventDefault();
        const { ops } = centerContentOps(doc, selected);
        if (ops.length) live.apply(ops, m.contentCenterLabel);
        return;
      }
      if (mod && key === "d" && nodes.length) {
        e.preventDefault();
        const ops: Op[] = [];
        const ids: string[] = [];
        for (const node of [...nodes].reverse()) {
          const input = toInput(doc, node.id);
          if (node.type === "connector") {
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
        if (
          t instanceof Element &&
          t.closest(
            '[data-slot="popover-content"], [data-slot="dialog-content"], [data-slot="tooltip-content"], [role="dialog"], [role="alertdialog"], [role="tooltip"]',
          )
        )
          return;
        if (document.querySelector('[data-slot="tooltip-content"]')) return;
        if (isHistoryOpen()) {
          setHistoryOpen(false);
          return;
        }
        setTool("select");
        const parent = nodes[0]?.parentId;
        setSelected(parent && doc.nodes[parent]?.type !== "page" ? [parent] : []);
        return;
      }
      if (nodes.length && e.key.startsWith("Arrow")) {
        if (t.closest?.('[role="radiogroup"]')) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key] ?? [0, 0];
        const ops: Op[] = nodes.filter((n) => !n.locked && n.type !== "connector").map((n) => ({ op: "update", id: n.id, props: { x: n.x + d[0]!, y: n.y + d[1]! } }));
        if (ops.length) live.apply(ops, "mover");
        return;
      }
      if (e.shiftKey && !mod && key === "i") {
        setPinsPanel((v) => !v);
        return;
      }
      const t2 = TOOL_DEFS.find((x) => x.key === e.key.toLowerCase());
      if (t2 && !mod) setTool(t2.tool);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc, selected, pageId, m, live.apply, live.showError]);

  if (!doc) {
    return (
      <div className={boot}>
        <img className="inline-block size-14 flex-none" src="/icon.svg" alt="" />
        <p>{live.connected ? m.loadingWorkspace : m.connectingServer}</p>
      </div>
    );
  }

  const tools = TOOL_DEFS.map((t) => ({ tool: t.tool, key: t.key, label: m[t.labelKey] as string, icon: t.icon }));

  const exportSvg = async () => {
    const root = selected.length === 1 ? selected[0]! : (pageId ?? "");
    try {
      const body = await api<{ svg?: string; warnings?: string[] }>(`/api/svg${root ? `?root=${encodeURIComponent(root)}` : ""}`);
      if (!body.svg) throw new Error(m.exportSvgMissing);
      const url = URL.createObjectURL(new Blob([body.svg], { type: "image/svg+xml" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(doc.nodes[root]?.name || doc.name || "paprika").replace(/[\\/:*?"<>|]+/g, "-")}.svg`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (body.warnings?.length) live.showError(m.exportSvgWarn(body.warnings.join("; ")));
    } catch (err) {
      live.showError(m.exportSvgFail(errorText(err)));
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
          <Hint label={m.allWorkspaces} side="bottom">
            <a
              className="group/home flex items-center gap-2 rounded-md text-inherit no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-ring"
              href="/"
              onClick={(e) => {
                e.preventDefault();
                navigate("/");
              }}
            >
              <img className={bar.logo} src="/icon.svg" alt="" />
              <strong className="group-hover/home:text-accent-ink">Paprika</strong>
            </a>
          </Hint>
          <span className="text-ui-border" aria-hidden>
            /
          </span>
          <h1 className="doc-name m-0 truncate text-ui-muted-foreground [font:inherit] max-wide:sr-only">{doc.name}</h1>
        </div>
        <div className={bar.status}>
          <PinsChip workspaceId={doc.id} />
          <LanguageSwitcher />
          {live.team !== undefined && <TeamChip status={live.team} onClick={() => setRightTab("team")} />}
          {lastAgent && Date.now() - lastAgent.at < 8000 && (
            <span className="agent-pill inline-flex max-w-[280px] items-center gap-1 rounded-full bg-accent-soft px-2 py-0.75 text-accent-ink">
              <Bot className="shrink-0" size={14} aria-hidden />
              <span className="truncate">{lastAgent.label}</span>
            </span>
          )}
          <span className={statusDotVariants({ tone: live.connected ? "ok" : "alert" })} aria-hidden />
          <span className={bar.statusText}>{live.connected ? `v${live.version} · ${m.mcpOn}` : m.disconnectedShort}</span>
          <ConnectionStatus connected={live.connected} />
        </div>
      </header>
      <aside aria-label={m.pagesAndLayers} className={cn("left contain-layout contain-paint overflow-auto border-r border-ui-border bg-ui-card [grid-area:left] max-wide:hidden", leftPanel.collapsed && "hidden")}>
        <Pages doc={doc} pageId={pageId} onOpen={openPage} apply={live.apply} />
        <Layers doc={doc} pageId={pageId} selected={selected} onSelect={setSelected} apply={live.apply} />
      </aside>
      <PanelResizer side="left" label={m.layersPanelWidth} panel={leftPanel} limits={LEFT_PANEL} />
      <main
        className={cn(
          "relative overflow-hidden [grid-area:center]",
          rightPanel.collapsed && "[&_[data-testid=agent-roster]]:top-14",
          toolbarDock === "left" && "[&_[data-panel-toggle=left]]:left-14",
          toolbarDock === "right" && "[&_[data-panel-toggle=right]]:right-14",
        )}
      >
        {leftPanel.collapsed && <PanelToggle side="left" label={m.showLayersPanel} panel={leftPanel} />}
        {rightPanel.collapsed && <PanelToggle side="right" label={m.showPropsPanel} panel={rightPanel} />}
        <Toolbar
          tools={tools}
          tool={tool}
          onTool={setTool}
          canUndo={live.canUndo}
          canRedo={live.canRedo}
          onUndo={() => void undoOwn()}
          onRedo={() => void redoOwn()}
          onHistory={() => setHistoryOpen((v) => !v)}
          onExport={exportSvg}
          dock={toolbarDock}
          onDock={setToolbarDock}
        />
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
        {historyOpen && (
          <HistoryPanel
            docId={doc.id}
            onSelectNodes={(ids) => {
              const hit = pageOfNodes(doc.nodes, ids);
              if (!hit.ids.length) return;
              if (hit.pageId && hit.pageId !== pageId) setPageChoice(hit.pageId);
              setSelected(hit.ids);
            }}
          />
        )}
        <ToastHost />
        <ErrorToast />
        <WorkspaceNotice />
      </main>
      <PanelResizer side="right" label={m.propsPanelWidth} panel={rightPanel} limits={RIGHT_PANEL} />
      <aside aria-label={m.properties} className={cn("right contain-layout contain-paint overflow-auto border-l border-ui-border bg-ui-card [grid-area:right] max-wide:border-t max-wide:border-l-0", rightPanel.collapsed && "hidden")}>
        {live.team !== undefined && (
          <Tabs
            value={rightTab}
            onValueChange={(v) => setRightTab(v as "inspector" | "team")}
            className="right-tabs m-3 mb-0 gap-0"
          >
            <TabsList className="grid h-auto w-full grid-cols-2 gap-0.5 rounded-md bg-night p-0.5" aria-label={m.rightPanel}>
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
                  {t === "inspector" ? m.inspectorTab : m.teamTab}
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
