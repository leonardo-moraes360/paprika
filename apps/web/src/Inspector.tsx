import { useEffect, useRef, useState } from "react";
import {
  copyOwner,
  groupOps,
  isInstance,
  lintDocument,
  newId,
  resolveValue,
  ungroupOps,
  type Document,
  type FrameNode,
  type GroupNode,
  type Node,
  type Op,
  type PageNode,
  type SceneNode,
} from "@paprika/core";
import type { Activity } from "./useDocument";

interface FieldProps {
  label: string;
  value: string | number | undefined;
  onCommit(v: string): void;
  type?: "text" | "number" | "textarea";
  placeholder?: string;
  title?: string;
}

/** Campo que só grava ao sair ou apertar Enter: uma entrada no histórico por edição. */
function Field({ label, value, onCommit, type = "text", placeholder, title }: FieldProps) {
  const [v, setV] = useState(value === undefined ? "" : String(value));
  // Enter grava e tira o foco; o blur não pode gravar de novo antes do servidor responder.
  const lastCommitted = useRef<string | null>(null);
  useEffect(() => {
    setV(value === undefined ? "" : String(value));
    lastCommitted.current = null;
  }, [value]);
  const commit = () => {
    if (v === (value === undefined ? "" : String(value)) || v === lastCommitted.current) return;
    lastCommitted.current = v;
    onCommit(v);
  };
  const common = {
    value: v,
    placeholder,
    title,
    "aria-label": label,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !(type === "textarea" && e.shiftKey)) {
        e.preventDefault();
        commit();
        (e.target as HTMLElement).blur();
      }
      if (e.key === "Escape") {
        setV(value === undefined ? "" : String(value));
        (e.target as HTMLElement).blur();
      }
    },
  };
  return (
    <label className={`field${type === "textarea" ? " field-wide" : ""}`}>
      <span>{label}</span>
      {type === "textarea" ? <textarea rows={3} {...common} /> : <input inputMode={type === "number" ? "decimal" : undefined} {...common} />}
    </label>
  );
}

function ColorField({ doc, label, value, onCommit }: { doc: Document; label: string; value: string | undefined; onCommit(v: string | null): void }) {
  const resolved = value ? String(resolveValue(doc, value)) : "";
  const hex = /^#[0-9a-f]{6}$/i.test(resolved) ? resolved : "#000000";
  return (
    <div className="color-field">
      <input type="color" aria-label={`${label} (seletor)`} value={hex} onChange={(e) => onCommit(e.target.value)} />
      <Field label={label} value={value} placeholder="nenhuma" title="#hex, rgba() ou $token" onCommit={(v) => onCommit(v.trim() || null)} />
    </div>
  );
}

const num = (v: string) => {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
};
const size = (v: string): number | string | undefined => (v === "hug" || v === "fill" ? v : num(v));

interface Props {
  doc: Document;
  node: Node | null;
  selected: string[];
  apply(ops: Op[], label?: string): void;
  activity: Activity[];
  onSelect(id: string): void;
  onSelectMany(ids: string[]): void;
  onError(message: string): void;
}

/** Agrupar/desagrupar com o mesmo plano do atalho e da ferramenta MCP; erros viram aviso. */
function structureActions(doc: Document, ids: string[], props: Pick<Props, "apply" | "onSelectMany" | "onError">) {
  const run = (f: () => void) => {
    try {
      f();
    } catch (e) {
      props.onError(e instanceof Error ? e.message : String(e));
    }
  };
  const groups = ids.filter((id) => doc.nodes[id]?.type === "group");
  return {
    canUngroup: groups.length > 0,
    group: () =>
      run(() => {
        groupOps(doc, ids); // valida antes de enviar
        const id = newId();
        props.apply([{ op: "group", ids, id }], "agrupar");
        props.onSelectMany([id]);
      }),
    ungroup: () =>
      run(() => {
        const { released } = ungroupOps(doc, groups);
        props.apply([{ op: "ungroup", ids: groups }], "desagrupar");
        props.onSelectMany(released);
      }),
  };
}

export function Inspector(props: Props) {
  const { doc, node, selected, apply, activity, onSelect } = props;
  if (selected.length > 1) {
    const a = structureActions(doc, selected, props);
    return (
      <div className="panel-section" data-testid="multi-selection">
        <h2>{selected.length} nós selecionados</h2>
        <div className="actions">
          <button onClick={a.group} title="Agrupar (Ctrl+G)">
            Agrupar
          </button>
          {a.canUngroup && (
            <button onClick={a.ungroup} title="Desagrupar (Ctrl+Shift+G)">
              Desagrupar
            </button>
          )}
        </div>
        <p className="muted">Arraste para mover todos; setas empurram; Delete apaga; Ctrl+D duplica.</p>
      </div>
    );
  }
  if (!node) return <DocumentPanel doc={doc} apply={apply} activity={activity} onSelect={onSelect} />;
  if (node.type === "page") return <PagePanel doc={doc} page={node} apply={apply} />;
  const owner = copyOwner(doc, node);
  if (owner) return <CopyPanel {...props} node={node as SceneNode} instance={owner} />;
  if (node.type === "group") return <GroupPanel {...props} group={node} />;
  if (isInstance(node)) return <InstancePanel {...props} instance={node} />;
  const set = (props: Record<string, unknown>, label = "editar propriedade") => apply([{ op: "update", id: node.id, props }], label);
  const setNum = (key: string) => (v: string) => {
    const n = num(v);
    if (n !== undefined) set({ [key]: n });
  };

  return (
    <div className="panel-section" key={node.id}>
      <h2>
        {node.type} <code className="muted">#{node.id}</code>
      </h2>
      <div className="grid">
        <Field label="Nome" value={node.name} onCommit={(v) => set({ name: v }, "renomear")} />
      </div>
      <h3>Posição e tamanho</h3>
      <div className="grid grid-2">
        <Field label="X" type="number" value={node.x} onCommit={setNum("x")} />
        <Field label="Y" type="number" value={node.y} onCommit={setNum("y")} />
        <Field label="L" type="number" value={node.width} title="número, hug ou fill" onCommit={(v) => size(v) !== undefined && set({ width: size(v) })} />
        <Field label="A" type="number" value={node.height} title="número, hug ou fill" onCommit={(v) => size(v) !== undefined && set({ height: size(v) })} />
        <Field label="Rotação" type="number" value={node.rotation} onCommit={setNum("rotation")} />
        <Field label="Opacidade" type="number" value={node.opacity} onCommit={setNum("opacity")} />
      </div>
      <h3>Aparência</h3>
      <div className="grid">
        <ColorField doc={doc} label="Preenchimento" value={node.fill} onCommit={(v) => set({ fill: v })} />
        {node.type !== "ellipse" && node.type !== "path" && <Field label="Raio" type="number" value={node.radius} onCommit={setNum("radius")} />}
        <ColorField
          doc={doc}
          label="Borda"
          value={node.stroke?.color}
          onCommit={(v) => set({ stroke: v ? { color: v, width: node.stroke?.width ?? 1 } : null })}
        />
        {node.stroke && <Field label="Espessura" type="number" value={node.stroke.width} onCommit={(v) => num(v) !== undefined && set({ stroke: { ...node.stroke!, width: num(v) } })} />}
      </div>

      {node.type === "text" && (
        <>
          <h3>Texto</h3>
          <div className="grid">
            <Field label="Conteúdo" type="textarea" value={node.text} onCommit={(v) => set({ text: v }, "editar texto")} />
            <ColorField doc={doc} label="Cor" value={node.color} onCommit={(v) => v && set({ color: v })} />
          </div>
          <div className="grid grid-2">
            <Field label="Tamanho" value={node.fontSize} onCommit={(v) => set({ fontSize: v.startsWith("$") ? v : num(v) })} />
            <Field label="Peso" type="number" value={node.fontWeight} onCommit={setNum("fontWeight")} />
            <Field label="Altura linha" type="number" value={node.lineHeight} onCommit={setNum("lineHeight")} />
            <label className="field">
              <span>Alinhamento</span>
              <select value={node.textAlign} onChange={(e) => set({ textAlign: e.target.value })}>
                <option value="left">esquerda</option>
                <option value="center">centro</option>
                <option value="right">direita</option>
              </select>
            </label>
          </div>
          <div className="grid">
            <Field label="Fonte" value={node.fontFamily} onCommit={(v) => set({ fontFamily: v })} />
          </div>
        </>
      )}

      {node.type === "frame" && (
        <>
          <h3>Componente</h3>
          <div className="actions" data-testid="component-actions">
            {node.component ? (
              <>
                <button
                  onClick={() => {
                    const id = newId();
                    const w = typeof node.width === "number" ? node.width : 0;
                    apply([{ op: "create", parentId: node.parentId, node: { type: "frame", id, name: node.name, instanceOf: node.id, x: node.x + w + 40, y: node.y } }], "criar instância");
                    props.onSelectMany([id]);
                  }}
                >
                  Nova instância
                </button>
                <button onClick={() => set({ component: null }, "deixar de ser componente")}>Deixar de ser componente</button>
              </>
            ) : (
              <button onClick={() => set({ component: true }, "criar componente")}>Tornar componente</button>
            )}
          </div>
          <h3>Layout</h3>
          <div className="grid grid-2">
            <label className="field">
              <span>Modo</span>
              <select
                value={node.layout?.mode ?? "none"}
                onChange={(e) => set({ layout: e.target.value === "none" ? null : { ...(node.layout ?? {}), mode: e.target.value } }, "layout")}
              >
                <option value="none">livre</option>
                <option value="row">linha</option>
                <option value="column">coluna</option>
              </select>
            </label>
            <label className="field">
              <span>Recortar</span>
              <select value={String(node.clip)} onChange={(e) => set({ clip: e.target.value === "true" })}>
                <option value="true">sim</option>
                <option value="false">não</option>
              </select>
            </label>
            {node.layout && node.layout.mode !== "none" && (
              <>
                <Field label="Gap" type="number" value={node.layout.gap} onCommit={(v) => num(v) !== undefined && set({ layout: { ...node.layout, gap: num(v) } })} />
                <Field
                  label="Padding"
                  value={Array.isArray(node.layout.padding) ? node.layout.padding.join(" ") : node.layout.padding}
                  title="1 valor ou 4 (t r b l)"
                  onCommit={(v) => {
                    const parts = v.trim().split(/[\s,]+/).map(Number);
                    const padding = parts.length === 4 ? parts : parts[0];
                    set({ layout: { ...node.layout, padding } });
                  }}
                />
                <label className="field">
                  <span>Alinhar</span>
                  <select value={node.layout.align} onChange={(e) => set({ layout: { ...node.layout, align: e.target.value } })}>
                    {["start", "center", "end", "stretch"].map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Distribuir</span>
                  <select value={node.layout.justify} onChange={(e) => set({ layout: { ...node.layout, justify: e.target.value } })}>
                    {["start", "center", "end", "between"].map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </div>
        </>
      )}

      {node.type === "path" && (
        <>
          <h3>Vetor</h3>
          <div className="grid">
            <Field label="Caminho (d)" type="textarea" value={node.d} title="M L H V C S Q T A Z (SVG). Duplo clique no vetor edita os pontos no canvas." onCommit={(v) => v.trim() && set({ d: v.trim() }, "editar caminho")} />
          </div>
          <div className="grid grid-2">
            <label className="field">
              <span>Regra</span>
              <select value={node.fillRule} onChange={(e) => set({ fillRule: e.target.value })}>
                <option value="nonzero">nonzero</option>
                <option value="evenodd">evenodd</option>
              </select>
            </label>
            <label className="field">
              <span>Ponta</span>
              <select value={node.strokeCap} onChange={(e) => set({ strokeCap: e.target.value })}>
                {["butt", "round", "square"].map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Junção</span>
              <select value={node.strokeJoin} onChange={(e) => set({ strokeJoin: e.target.value })}>
                {["miter", "round", "bevel"].map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </label>
          </div>
        </>
      )}

      {node.type === "image" && (
        <>
          <h3>Imagem</h3>
          <div className="grid">
            <Field label="URL" value={node.src.startsWith("data:") ? "(data URI)" : node.src} onCommit={(v) => set({ src: v })} />
            <Field label="Alt" value={node.alt} onCommit={(v) => set({ alt: v })} />
          </div>
        </>
      )}

      <h3>Notas para agentes</h3>
      <div className="grid">
        <Field label="Notas" type="textarea" value={node.notes} placeholder="Intenção, restrições, conteúdo real…" onCommit={(v) => set({ notes: v || null })} />
      </div>
    </div>
  );
}

/** Instância: posição e escala são dela; o resto vem do componente (fill aceita override). */
function InstancePanel({ instance: node, ...props }: Props & { instance: FrameNode & { instanceOf: string } }) {
  const { doc, apply, onSelect, onError } = props;
  const comp = doc.nodes[node.instanceOf];
  const set = (p: Record<string, unknown>, label = "editar instância") => apply([{ op: "update", id: node.id, props: p }], label);
  const setNum = (key: string) => (v: string) => {
    const n = num(v);
    if (n !== undefined) set({ [key]: n });
  };
  const overrides = Object.keys(node.overrides ?? {}).length;
  return (
    <div className="panel-section" key={node.id} data-testid="instance-panel">
      <h2>
        instância <code className="muted">#{node.id}</code>
      </h2>
      <p className="muted">
        de <button className="link" onClick={() => onSelect(node.instanceOf)}>{comp?.name || node.instanceOf}</button>
        {overrides > 0 && ` · ${overrides} override(s)`}
      </p>
      <div className="grid">
        <Field label="Nome" value={node.name} onCommit={(v) => set({ name: v }, "renomear")} />
      </div>
      <div className="grid grid-2">
        <Field label="X" type="number" value={node.x} onCommit={setNum("x")} />
        <Field label="Y" type="number" value={node.y} onCommit={setNum("y")} />
        <Field label="Escala" type="number" value={node.scale ?? 1} title="0.01 a 100" onCommit={setNum("scale")} />
        <Field label="Rotação" type="number" value={node.rotation} onCommit={setNum("rotation")} />
        <Field label="Opacidade" type="number" value={node.opacity} onCommit={setNum("opacity")} />
        <Field label="Tamanho" value={`${node.width}×${node.height}`} onCommit={() => onError("o tamanho vem do componente; mude a escala")} />
      </div>
      <div className="grid">
        <ColorField doc={doc} label="Preenchimento" value={node.fill} onCommit={(v) => set({ fill: v }, "override")} />
      </div>
      <div className="actions">
        <button onClick={() => onSelect(node.instanceOf)}>Ir para o componente</button>
        {overrides > 0 && <button onClick={() => set({ overrides: null }, "limpar overrides")}>Limpar overrides</button>}
        <button onClick={() => apply([{ op: "detach", ids: [node.id] }], "desanexar instância")}>Desanexar</button>
      </div>
      <h3>Notas para agentes</h3>
      <div className="grid">
        <Field label="Notas" type="textarea" value={node.notes} onCommit={(v) => set({ notes: v || null })} />
      </div>
    </div>
  );
}

/** Cópia dentro de uma instância: só os campos de aparência viram override. */
function CopyPanel({ node, instance, ...props }: Props & { node: SceneNode; instance: FrameNode }) {
  const { doc, apply, onSelect } = props;
  const set = (p: Record<string, unknown>) => apply([{ op: "update", id: node.id, props: p }], "override");
  const src = node.sourceId!;
  const ov = instance.overrides?.[src] ?? {};
  return (
    <div className="panel-section" key={node.id} data-testid="copy-panel">
      <h2>
        {node.type} <code className="muted">#{node.id}</code>
      </h2>
      <p className="muted">
        cópia de <button className="link" onClick={() => onSelect(src)}>#{src}</button> na instância{" "}
        <button className="link" onClick={() => onSelect(instance.id)}>{instance.name || instance.id}</button>
      </p>
      <div className="grid">
        {node.type === "text" && <Field label="Conteúdo" type="textarea" value={node.text} onCommit={(v) => set({ text: v })} />}
        {node.type === "text" && <ColorField doc={doc} label="Cor" value={node.color} onCommit={(v) => set({ color: v })} />}
        {node.type !== "group" && <ColorField doc={doc} label="Preenchimento" value={node.fill} onCommit={(v) => set({ fill: v })} />}
        {node.type === "image" && <Field label="URL" value={node.src.startsWith("data:") ? "(data URI)" : node.src} onCommit={(v) => set({ src: v })} />}
        <Field label="Opacidade" type="number" value={node.opacity} onCommit={(v) => num(v) !== undefined && set({ opacity: num(v) })} />
        <label className="field">
          <span>Visível</span>
          <select value={String(node.visible)} onChange={(e) => set({ visible: e.target.value === "true" })}>
            <option value="true">sim</option>
            <option value="false">não</option>
          </select>
        </label>
      </div>
      {Object.keys(ov).length > 0 && (
        <div className="actions">
          <button onClick={() => set(Object.fromEntries(Object.keys(ov).map((k) => [k, null])))}>Restaurar do componente</button>
        </div>
      )}
      <p className="muted">Posição, tamanho e estrutura vêm do componente.</p>
    </div>
  );
}

function PagePanel({ doc, page, apply }: { doc: Document; page: PageNode; apply(ops: Op[], label?: string): void }) {
  const set = (props: Record<string, unknown>, label = "editar página") => apply([{ op: "update", id: page.id, props }], label);
  return (
    <div className="panel-section" key={page.id}>
      <h2>
        page <code className="muted">#{page.id}</code>
      </h2>
      <div className="grid">
        <Field label="Nome" value={page.name} onCommit={(v) => set({ name: v }, "renomear página")} />
        <ColorField doc={doc} label="Fundo" value={page.fill} onCommit={(v) => set({ fill: v })} />
        <Field label="Notas" type="textarea" value={page.notes} onCommit={(v) => set({ notes: v || null })} />
      </div>
    </div>
  );
}

function GroupPanel({ group, ...props }: Props & { group: GroupNode }) {
  const set = (p: Record<string, unknown>, label = "editar grupo") => props.apply([{ op: "update", id: group.id, props: p }], label);
  const setNum = (key: string) => (v: string) => {
    const n = num(v);
    if (n !== undefined) set({ [key]: n });
  };
  const a = structureActions(props.doc, [group.id], props);
  return (
    <div className="panel-section" key={group.id}>
      <h2>
        group <code className="muted">#{group.id}</code>
      </h2>
      <div className="grid">
        <Field label="Nome" value={group.name} onCommit={(v) => set({ name: v }, "renomear")} />
      </div>
      <h3>Posição</h3>
      <div className="grid grid-2">
        <Field label="X" type="number" value={group.x} onCommit={setNum("x")} />
        <Field label="Y" type="number" value={group.y} onCommit={setNum("y")} />
        <Field label="Opacidade" type="number" value={group.opacity} onCommit={setNum("opacity")} />
      </div>
      <p className="muted">
        {group.width} × {group.height}: a caixa segue os {group.children.length} filho(s). Duplo clique no canvas seleciona um filho.
      </p>
      <div className="actions">
        <button onClick={a.ungroup} title="Desagrupar (Ctrl+Shift+G)">
          Desagrupar
        </button>
      </div>
      <h3>Notas para agentes</h3>
      <div className="grid">
        <Field label="Notas" type="textarea" value={group.notes} onCommit={(v) => set({ notes: v || null })} />
      </div>
    </div>
  );
}

function DocumentPanel({ doc, apply, activity, onSelect }: { doc: Document; apply(ops: Op[], label?: string): void; activity: Activity[]; onSelect(id: string): void }) {
  const [newToken, setNewToken] = useState("");
  const issues = lintDocument(doc).filter((i) => i.severity !== "info");
  return (
    <div className="panel-section">
      <h2>Documento</h2>
      <div className="grid">
        <Field label="Nome" value={doc.name} onCommit={(v) => v.trim() && apply([{ op: "rename_document", name: v.trim() }], "renomear documento")} />
      </div>
      <h3>Tokens</h3>
      <div className="grid">
        {Object.entries(doc.tokens).map(([k, v]) => (
          <div className="token-row" key={k}>
            {typeof v === "string" && /^#|^rgb/.test(v) && <span className="swatch" style={{ background: v }} />}
            <Field label={`$${k}`} value={v} onCommit={(nv) => apply([{ op: "set_tokens", tokens: { [k]: nv === "" ? null : isNaN(Number(nv)) ? nv : Number(nv) } }], "token")} />
          </div>
        ))}
        <form
          className="token-add"
          onSubmit={(e) => {
            e.preventDefault();
            const m = /^\s*\$?([\w.-]+)\s*[=:]\s*(.+)$/.exec(newToken);
            if (!m) return;
            const val = m[2]!.trim();
            apply([{ op: "set_tokens", tokens: { [m[1]!]: isNaN(Number(val)) ? val : Number(val) } }], "token");
            setNewToken("");
          }}
        >
          <input aria-label="Novo token" placeholder="nome = #e8553d" value={newToken} onChange={(e) => setNewToken(e.target.value)} />
        </form>
      </div>
      <h3>Revisão {issues.length > 0 && <span className="badge">{issues.length}</span>}</h3>
      {issues.length === 0 ? (
        <p className="muted">Sem problemas de contraste, overflow ou tokens.</p>
      ) : (
        <ul className="issues">
          {issues.slice(0, 30).map((i, k) => (
            <li key={k} className={`sev-${i.severity}`} onClick={() => onSelect(i.nodeId)}>
              <strong>{i.rule}</strong> {i.message}
            </li>
          ))}
        </ul>
      )}
      <h3>Atividade</h3>
      <ul className="activity">
        {activity.length === 0 && <li className="muted">Nenhuma edição ainda.</li>}
        {activity.slice(0, 15).map((a) => (
          <li key={a.id} className={a.actor.startsWith("agent") ? "is-agent" : ""}>
            <span className="who">{a.actor.startsWith("agent") ? "🤖 " + a.actor.slice(6) : a.actor === "user" ? "você" : a.actor}</span>
            <span>{a.label || "edição"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
