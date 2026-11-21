import { useEffect, useRef, useState } from "react";
import { newId, type Document, type NodeInput, type Op } from "@paprika/core";
import { Canvas, type Tool } from "./Canvas";
import { Inspector } from "./Inspector";
import { Layers } from "./Layers";
import { useDocument } from "./useDocument";

const TOOLS: { tool: Tool; key: string; label: string; icon: string }[] = [
  { tool: "select", key: "v", label: "Selecionar", icon: "↖" },
  { tool: "frame", key: "f", label: "Frame", icon: "#" },
  { tool: "rect", key: "r", label: "Retângulo", icon: "▭" },
  { tool: "ellipse", key: "o", label: "Elipse", icon: "◯" },
  { tool: "text", key: "t", label: "Texto", icon: "T" },
];

/** Converte uma subárvore em NodeInput com ids novos (para duplicar). */
function toInput(doc: Document, id: string): NodeInput {
  const n = doc.nodes[id]!;
  const { id: _id, parentId: _p, ...rest } = n as Record<string, unknown> & { id: string; parentId: string | null };
  const input: NodeInput = { ...(rest as Omit<NodeInput, "id">), type: n.type, id: newId() };
  if (n.type === "frame") input.children = n.children.map((c) => toInput(doc, c));
  else delete input.children;
  return input;
}

export function App() {
  const live = useDocument();
  const { doc } = live;
  const [selected, setSelected] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("select");

  // Limpa a seleção só quando o nó deixou de existir (não quando ainda está a caminho do servidor).
  const prevDoc = useRef(doc);
  useEffect(() => {
    if (selected && doc && prevDoc.current?.nodes[selected] && !doc.nodes[selected]) setSelected(null);
    prevDoc.current = doc;
  }, [doc, selected]);

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
      const node = selected ? doc.nodes[selected] : undefined;
      if (mod && e.key.toLowerCase() === "d" && node) {
        e.preventDefault();
        const input = toInput(doc, node.id);
        input.x = node.x + 20;
        input.y = node.y + 20;
        const siblings = node.parentId ? (doc.nodes[node.parentId] as { children: string[] }).children : doc.rootIds;
        live.apply([{ op: "create", node: input, parentId: node.parentId, index: siblings.indexOf(node.id) + 1 }], "duplicar");
        setSelected(input.id!);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && node) {
        e.preventDefault();
        live.apply([{ op: "delete", id: node.id }], "apagar");
        setSelected(null);
        return;
      }
      if (e.key === "Escape") {
        setTool("select");
        setSelected(node?.parentId ?? null);
        return;
      }
      if (node && e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key] ?? [0, 0];
        const op: Op = { op: "update", id: node.id, props: { x: node.x + d[0]!, y: node.y + d[1]! } };
        live.apply([op], "mover");
        return;
      }
      const t2 = TOOLS.find((x) => x.key === e.key.toLowerCase());
      if (t2 && !mod) setTool(t2.tool);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc, selected, live.apply, live.undo, live.redo]);

  if (!doc) {
    return (
      <div className="boot">
        <div className="logo" />
        <p>{live.connected ? "Carregando documento…" : "Conectando ao servidor Paprika…"}</p>
      </div>
    );
  }

  const node = selected ? (doc.nodes[selected] ?? null) : null;
  const lastAgent = live.activity.find((a) => a.actor.startsWith("agent"));

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden />
          <strong>Paprika</strong>
          <span className="doc-name">{doc.name}</span>
        </div>
        <nav className="tools" aria-label="Ferramentas">
          {TOOLS.map((t) => (
            <button
              key={t.tool}
              className={tool === t.tool ? "is-active" : ""}
              onClick={() => setTool(t.tool)}
              title={`${t.label} (${t.key.toUpperCase()})`}
              aria-pressed={tool === t.tool}
              aria-label={t.label}
            >
              {t.icon}
            </button>
          ))}
          <span className="sep" />
          <button onClick={live.undo} disabled={!live.canUndo} title="Desfazer (Ctrl+Z)" aria-label="Desfazer">
            ↶
          </button>
          <button onClick={live.redo} disabled={!live.canRedo} title="Refazer (Ctrl+Shift+Z)" aria-label="Refazer">
            ↷
          </button>
        </nav>
        <div className="status">
          {lastAgent && Date.now() - lastAgent.at < 8000 && <span className="agent-pill">🤖 {lastAgent.label}</span>}
          <span className={`dot ${live.connected ? "on" : "off"}`} />
          <span className="muted">{live.connected ? `v${live.version} · MCP em /mcp` : "desconectado"}</span>
        </div>
      </header>
      <aside className="left">
        <Layers doc={doc} selected={selected} onSelect={setSelected} apply={live.apply} />
      </aside>
      <main className="center">
        <Canvas
          doc={doc}
          selected={selected}
          onSelect={setSelected}
          tool={tool}
          onToolDone={() => setTool("select")}
          apply={live.apply}
          agentTouched={live.agentTouched}
        />
        {live.error && (
          <div className="toast" role="alert" onClick={live.clearError}>
            {live.error}
          </div>
        )}
      </main>
      <aside className="right">
        <Inspector doc={doc} node={node} apply={live.apply} activity={live.activity} onSelect={setSelected} />
      </aside>
    </div>
  );
}
