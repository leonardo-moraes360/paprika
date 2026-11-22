import { useState } from "react";
import {
  copyOwner,
  groupOps,
  isInstance,
  lintDocument,
  newId,
  modeOf,
  ungroupOps,
  type ConnectorEnd,
  type ConnectorNode,
  type Document,
  type FrameNode,
  type GroupNode,
  type Node,
  type Op,
  type PageNode,
  type SceneNode,
} from "@paprika/core";
import { Activity } from "./Activity";
import type { Activity as ActivityEntry } from "./useDocument";
import { ColorField, Field, ModeField, num, size } from "./inspector/fields";
import { InspectorSection } from "./inspector/InspectorSection";
import { cx, ui } from "./ui";

export { parseModeTokenAssignment, parseTokenAssignment, tokenValue } from "./inspector/tokenParsing";
import { parseModeTokenAssignment, parseTokenAssignment, tokenValue } from "./inspector/tokenParsing";

const list = "m-0 grid list-none gap-1 p-0";
const tokenAdd = "h-7 w-full rounded-md border border-dashed border-line bg-transparent px-2";
const SEVERITY: Record<string, string> = { error: "border-l-accent", warning: "border-l-warn" };

interface Props {
  doc: Document;
  node: Node | null;
  selected: string[];
  apply(ops: Op[], label?: string): void;
  activity: ActivityEntry[];
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

const Z_LABEL: Record<"front" | "back" | "forward" | "backward", string> = {
  front: "trazer para frente",
  forward: "avançar",
  backward: "recuar",
  back: "enviar para fundo",
};

function ArrangeSection({ ids, apply }: { ids: string[]; apply: Props["apply"] }) {
  const run = (index: keyof typeof Z_LABEL) =>
    apply(
      ids.map((id) => ({ op: "update", id, props: { index } })),
      Z_LABEL[index],
    );
  return (
    <InspectorSection id="arrange" title="Ordem" defaultOpen>
      <div className={ui.actions} data-testid="arrange-actions">
        <button type="button" data-testid="arrange-front" title="Trazer para frente (Ctrl+Page Up)" onClick={() => run("front")}>
          Trazer para frente
        </button>
        <button type="button" data-testid="arrange-forward" title="Avançar (Page Up)" onClick={() => run("forward")}>
          Avançar
        </button>
        <button type="button" data-testid="arrange-backward" title="Recuar (Page Down)" onClick={() => run("backward")}>
          Recuar
        </button>
        <button type="button" data-testid="arrange-back" title="Enviar para fundo (Ctrl+Page Down)" onClick={() => run("back")}>
          Enviar para fundo
        </button>
      </div>
    </InspectorSection>
  );
}

export function Inspector(props: Props) {
  const { doc, node, selected, apply, activity, onSelect } = props;
  if (selected.length > 1) {
    const a = structureActions(doc, selected, props);
    return (
      <div className={ui.section} data-testid="multi-selection">
        <h2 className={ui.h2}>{selected.length} nós selecionados</h2>
        <div className={ui.actions}>
          <button onClick={a.group} title="Agrupar (Ctrl+G)">
            Agrupar
          </button>
          {a.canUngroup && (
            <button onClick={a.ungroup} title="Desagrupar (Ctrl+Shift+G)">
              Desagrupar
            </button>
          )}
        </div>
        <ArrangeSection ids={selected} apply={apply} />
        <p className={ui.muted}>Arraste para mover todos; setas empurram; Delete apaga; Ctrl+D duplica.</p>
      </div>
    );
  }
  if (!node) return <DocumentPanel doc={doc} apply={apply} activity={activity} onSelect={onSelect} />;
  if (node.type === "page") return <PagePanel doc={doc} page={node} apply={apply} />;
  const owner = copyOwner(doc, node);
  if (owner) return <CopyPanel {...props} node={node as SceneNode} instance={owner} />;
  if (node.type === "group") return <GroupPanel {...props} group={node} />;
  if (node.type === "connector") return <ConnectorPanel {...props} connector={node} />;
  if (isInstance(node)) return <InstancePanel {...props} instance={node} />;
  const set = (props: Record<string, unknown>, label = "editar propriedade") => apply([{ op: "update", id: node.id, props }], label);
  const themeMode = modeOf(doc, node);
  const setNum = (key: string) => (v: string) => {
    const n = num(v);
    if (n !== undefined) set({ [key]: n });
  };

  return (
    <div className={ui.section} key={node.id}>
      <h2 className={ui.h2}>
        {node.type} <code className={ui.muted}>#{node.id}</code>
      </h2>
      <div className={ui.grid}>
        <Field label="Nome" value={node.name} onCommit={(v) => set({ name: v }, "renomear")} />
      </div>
      <InspectorSection id="position" title="Posição e tamanho" defaultOpen>
        <div className={ui.grid2}>
          <Field label="X" type="number" value={node.x} onCommit={setNum("x")} />
          <Field label="Y" type="number" value={node.y} onCommit={setNum("y")} />
          <Field label="L" type="number" value={node.width} title="número, hug ou fill" keywords={["hug", "fill"]} onCommit={(v) => size(v) !== undefined && set({ width: size(v) })} />
          <Field label="A" type="number" value={node.height} title="número, hug ou fill" keywords={["hug", "fill"]} onCommit={(v) => size(v) !== undefined && set({ height: size(v) })} />
          <Field label="Rotação" type="number" value={node.rotation} onCommit={setNum("rotation")} />
          <Field label="Opacidade" type="number" value={node.opacity} min={0} max={1} onCommit={setNum("opacity")} />
        </div>
      </InspectorSection>
      <InspectorSection id="appearance" title="Preenchimento e traço">
        <div className={ui.grid}>
          <ColorField doc={doc} mode={themeMode} label="Preenchimento" value={node.fill} onCommit={(v) => set({ fill: v })} />
          {node.type !== "ellipse" && node.type !== "path" && <Field label="Raio" type="number" value={node.radius} min={0} onCommit={setNum("radius")} />}
          <ColorField
            doc={doc}
            mode={themeMode}
            label="Borda"
            value={node.stroke?.color}
            onCommit={(v) => set({ stroke: v ? { color: v, width: node.stroke?.width ?? 1 } : null })}
          />
          {node.stroke && <Field label="Espessura" type="number" value={node.stroke.width} min={0} onCommit={(v) => num(v) !== undefined && set({ stroke: { ...node.stroke!, width: num(v) } })} />}
        </div>
      </InspectorSection>

      {node.type === "text" && (
        <InspectorSection id="text" title="Texto">
          <div className={ui.grid}>
            <Field label="Conteúdo" type="textarea" value={node.text} onCommit={(v) => set({ text: v }, "editar texto")} />
            <ColorField doc={doc} mode={themeMode} label="Cor" value={node.color} onCommit={(v) => v && set({ color: v })} />
          </div>
          <div className={ui.grid2}>
            <Field label="Tamanho" value={node.fontSize} onCommit={(v) => set({ fontSize: v.startsWith("$") ? v : num(v) })} />
            <Field label="Peso" type="number" value={node.fontWeight} min={100} max={900} integer onCommit={setNum("fontWeight")} />
            <Field label="Altura linha" type="number" value={node.lineHeight} min={0} onCommit={setNum("lineHeight")} />
            <label className={ui.field()}>
              <span>Alinhamento</span>
              <select aria-label="Alinhamento" value={node.textAlign} onChange={(e) => set({ textAlign: e.target.value })}>
                <option value="left">esquerda</option>
                <option value="center">centro</option>
                <option value="right">direita</option>
              </select>
            </label>
          </div>
          <Field label="Fonte" value={node.fontFamily} onCommit={(v) => set({ fontFamily: v })} />
        </InspectorSection>
      )}

      {node.type === "shape" && (
        <InspectorSection id="shape" title="Forma" defaultOpen>
          <div className={ui.grid}>
            <label className={ui.field()}>
              <span>Tipo</span>
              <select value={node.shape} onChange={(e) => set({ shape: e.target.value }, "trocar forma")} data-testid="shape-kind">
                <option value="rect">caixa</option>
                <option value="ellipse">oval</option>
                <option value="diamond">losango (decisão)</option>
                <option value="triangle">triângulo</option>
                <option value="note">nota adesiva</option>
              </select>
            </label>
            <Field label="Texto" type="textarea" value={node.text} title="Duplo clique na forma edita o texto no canvas" onCommit={(v) => set({ text: v }, "editar texto")} />
            <ColorField doc={doc} mode={themeMode} label="Cor do texto" value={node.color} onCommit={(v) => v && set({ color: v })} />
          </div>
          <div className={ui.grid2}>
            <Field label="Tamanho" value={node.fontSize} onCommit={(v) => set({ fontSize: v.startsWith("$") ? v : num(v) })} />
            <Field label="Peso" type="number" value={node.fontWeight} min={100} max={900} integer onCommit={setNum("fontWeight")} />
            <label className={ui.field()}>
              <span>Alinhamento</span>
              <select aria-label="Alinhamento" value={node.textAlign} onChange={(e) => set({ textAlign: e.target.value })}>
                <option value="left">esquerda</option>
                <option value="center">centro</option>
                <option value="right">direita</option>
              </select>
            </label>
          </div>
        </InspectorSection>
      )}

      {node.type === "frame" && (
        <>
          <InspectorSection id="frame-component" title="Componente" defaultOpen>
            <div className={ui.actions} data-testid="component-actions">
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
          </InspectorSection>
          <InspectorSection id="frame-theme" title="Modo de tema" defaultOpen>
            <ModeField doc={doc} value={node.mode} inherited={modeOf(doc, node.parentId ? doc.nodes[node.parentId] : undefined)} onCommit={(v) => set({ mode: v }, "modo de tema")} />
          </InspectorSection>
          <InspectorSection id="frame-layout" title="Layout auto" defaultOpen={!!node.layout?.mode && node.layout.mode !== "none"}>
            <div className={ui.grid2}>
              <label className={ui.field()}>
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
              <label className={ui.field()}>
                <span>Recortar</span>
                <select value={String(node.clip)} onChange={(e) => set({ clip: e.target.value === "true" })}>
                  <option value="true">sim</option>
                  <option value="false">não</option>
                </select>
              </label>
              {node.layout && node.layout.mode !== "none" && (
                <>
                  <Field label="Gap" type="number" value={node.layout.gap} min={0} onCommit={(v) => num(v) !== undefined && set({ layout: { ...node.layout, gap: num(v) } })} />
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
                  <label className={ui.field()}>
                    <span>Alinhar</span>
                    <select value={node.layout.align} onChange={(e) => set({ layout: { ...node.layout, align: e.target.value } })}>
                      {["start", "center", "end", "stretch"].map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  </label>
                  <label className={ui.field()}>
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
          </InspectorSection>
        </>
      )}

      {node.type === "path" && (
        <InspectorSection id="path" title="Vetor" defaultOpen>
          <Field label="Caminho (d)" type="textarea" value={node.d} title="M L H V C S Q T A Z (SVG). Duplo clique no vetor edita os pontos no canvas." onCommit={(v) => v.trim() && set({ d: v.trim() }, "editar caminho")} />
          <div className={ui.grid2}>
            <label className={ui.field()}>
              <span>Regra</span>
              <select value={node.fillRule} onChange={(e) => set({ fillRule: e.target.value })}>
                <option value="nonzero">nonzero</option>
                <option value="evenodd">evenodd</option>
              </select>
            </label>
            <label className={ui.field()}>
              <span>Ponta</span>
              <select value={node.strokeCap} onChange={(e) => set({ strokeCap: e.target.value })}>
                {["butt", "round", "square"].map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </label>
            <label className={ui.field()}>
              <span>Junção</span>
              <select value={node.strokeJoin} onChange={(e) => set({ strokeJoin: e.target.value })}>
                {["miter", "round", "bevel"].map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </label>
          </div>
        </InspectorSection>
      )}

      {node.type === "image" && (
        <InspectorSection id="image" title="Imagem" defaultOpen>
          <Field label="URL" value={node.src.startsWith("data:") ? "(data URI)" : node.src} onCommit={(v) => set({ src: v })} />
          <Field label="Alt" value={node.alt} onCommit={(v) => set({ alt: v })} />
        </InspectorSection>
      )}

      <ArrangeSection ids={[node.id]} apply={apply} />

      <InspectorSection id="notes" title="Notas para agentes">
        <Field label="Notas" type="textarea" value={node.notes} placeholder="Intenção, restrições, conteúdo real…" onCommit={(v) => set({ notes: v || null })} />
      </InspectorSection>
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
    <div className={ui.section} key={node.id} data-testid="instance-panel">
      <h2 className={ui.h2}>
        instância <code className={ui.muted}>#{node.id}</code>
      </h2>
      <p className={ui.muted}>
        de <button className={ui.link} onClick={() => onSelect(node.instanceOf)}>{comp?.name || node.instanceOf}</button>
        {overrides > 0 && ` · ${overrides} override(s)`}
      </p>
      <div className={ui.grid}>
        <Field label="Nome" value={node.name} onCommit={(v) => set({ name: v }, "renomear")} />
      </div>
      <InspectorSection id="instance-transform" title="Posição e transformação" defaultOpen>
        <div className={ui.grid2}>
          <Field label="X" type="number" value={node.x} onCommit={setNum("x")} />
          <Field label="Y" type="number" value={node.y} onCommit={setNum("y")} />
          <Field label="Escala" type="number" value={node.scale ?? 1} title="0.01 a 100" min={0.01} max={100} onCommit={setNum("scale")} />
          <Field label="Rotação" type="number" value={node.rotation} onCommit={setNum("rotation")} />
          <Field label="Opacidade" type="number" value={node.opacity} min={0} max={1} onCommit={setNum("opacity")} />
          <Field label="Tamanho" value={`${node.width}×${node.height}`} onCommit={() => onError("o tamanho vem do componente; mude a escala")} />
        </div>
      </InspectorSection>
      <InspectorSection id="instance-fill" title="Preenchimento">
        <ColorField doc={doc} label="Preenchimento" value={node.fill} onCommit={(v) => set({ fill: v }, "override")} />
      </InspectorSection>
      <ArrangeSection ids={[node.id]} apply={apply} />
      <div className={ui.actions}>
        <button onClick={() => onSelect(node.instanceOf)}>Ir para o componente</button>
        {overrides > 0 && <button onClick={() => set({ overrides: null }, "limpar overrides")}>Limpar overrides</button>}
        <button onClick={() => apply([{ op: "detach", ids: [node.id] }], "desanexar instância")}>Desanexar</button>
      </div>
      <InspectorSection id="notes" title="Notas para agentes">
        <Field label="Notas" type="textarea" value={node.notes} onCommit={(v) => set({ notes: v || null })} />
      </InspectorSection>
    </div>
  );
}

/** Conector: rótulo, pontas, rota, setas e traço. A geometria é calculada pelo servidor a partir das pontas. */
function ConnectorPanel({ connector: node, ...props }: Props & { connector: ConnectorNode }) {
  const { doc, apply, onSelect } = props;
  const set = (p: Record<string, unknown>, label = "editar conector") => apply([{ op: "update", id: node.id, props: p }], label);
  const end = (key: "from" | "to", e: ConnectorEnd) => {
    const label = key === "from" ? "Início" : "Fim";
    if (e.nodeId === undefined)
      return (
        <p className={ui.muted} key={key}>
          {label}: ponto solto ({e.x}, {e.y})
        </p>
      );
    return (
      <div className={ui.grid2} key={key}>
        <p className={ui.muted}>
          {label}: <button className={ui.link} onClick={() => onSelect(e.nodeId!)}>{doc.nodes[e.nodeId]?.name || `#${e.nodeId}`}</button>
        </p>
        <label className={ui.field()}>
          <span>Lado</span>
          <select value={e.side ?? "auto"} onChange={(ev) => set({ [key]: { nodeId: e.nodeId, side: ev.target.value } })} data-testid={`connector-${key}-side`}>
            {["auto", "top", "right", "bottom", "left"].map((o) => (
              <option key={o} value={o}>
                {{ auto: "automático", top: "cima", right: "direita", bottom: "baixo", left: "esquerda" }[o]}
              </option>
            ))}
          </select>
        </label>
      </div>
    );
  };
  return (
    <div className={ui.section} key={node.id} data-testid="connector-panel">
      <h2 className={ui.h2}>
        connector <code className={ui.muted}>#{node.id}</code>
      </h2>
      <div className={ui.grid}>
        <Field label="Nome" value={node.name} onCommit={(v) => set({ name: v }, "renomear")} />
        <Field label="Rótulo" value={node.label ?? ""} placeholder="sim, não…" onCommit={(v) => set({ label: v.trim() ? v.trim() : null }, "editar rótulo")} />
        <p className={ui.muted}>Aparece no meio da seta. Vazio = sem rótulo.</p>
      </div>
      <InspectorSection id="connector-ends" title="Pontas" defaultOpen>
        {end("from", node.from)}
        {end("to", node.to)}
      </InspectorSection>
      <InspectorSection id="connector-stroke" title="Traço" defaultOpen>
        <div className={ui.grid2}>
        <label className={ui.field()}>
          <span>Rota</span>
          <select value={node.route} onChange={(e) => set({ route: e.target.value })} data-testid="connector-route">
            <option value="straight">reta</option>
            <option value="elbow">cotovelo</option>
          </select>
        </label>
        <label className={ui.field()}>
          <span>Tracejado</span>
          <select value={String(node.dashed)} onChange={(e) => set({ dashed: e.target.value === "true" })}>
            <option value="false">não</option>
            <option value="true">sim</option>
          </select>
        </label>
        <label className={ui.field()}>
          <span>Seta no início</span>
          <select value={node.startArrow} onChange={(e) => set({ startArrow: e.target.value })}>
            <option value="none">nenhuma</option>
            <option value="arrow">seta</option>
          </select>
        </label>
        <label className={ui.field()}>
          <span>Seta no fim</span>
          <select value={node.endArrow} onChange={(e) => set({ endArrow: e.target.value })}>
            <option value="none">nenhuma</option>
            <option value="arrow">seta</option>
          </select>
        </label>
        <ColorField doc={doc} mode={modeOf(doc, node)} label="Cor" value={node.stroke.color} onCommit={(v) => v && set({ stroke: { ...node.stroke, color: v } })} />
        <Field label="Espessura" type="number" value={node.stroke.width} min={0} onCommit={(v) => num(v) !== undefined && set({ stroke: { ...node.stroke, width: num(v) } })} />
        <Field label="Opacidade" type="number" value={node.opacity} min={0} max={1} onCommit={(v) => num(v) !== undefined && set({ opacity: num(v) })} />
        </div>
        <p className={ui.muted}>A linha segue as formas: mova as formas ou troque os lados para redesenhar.</p>
      </InspectorSection>
      <ArrangeSection ids={[node.id]} apply={apply} />
      <InspectorSection id="notes" title="Notas para agentes">
        <Field label="Notas" type="textarea" value={node.notes} onCommit={(v) => set({ notes: v || null })} />
      </InspectorSection>
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
    <div className={ui.section} key={node.id} data-testid="copy-panel">
      <h2 className={ui.h2}>
        {node.type} <code className={ui.muted}>#{node.id}</code>
      </h2>
      <p className={ui.muted}>
        cópia de <button className={ui.link} onClick={() => onSelect(src)}>#{src}</button> na instância{" "}
        <button className={ui.link} onClick={() => onSelect(instance.id)}>{instance.name || instance.id}</button>
      </p>
      <InspectorSection id="copy-appearance" title="Aparência" defaultOpen>
        <div className={ui.grid}>
          {node.type === "text" && <Field label="Conteúdo" type="textarea" value={node.text} onCommit={(v) => set({ text: v })} />}
          {node.type === "text" && <ColorField doc={doc} label="Cor" value={node.color} onCommit={(v) => set({ color: v })} />}
          {node.type !== "group" && node.type !== "connector" && <ColorField doc={doc} label="Preenchimento" value={node.fill} onCommit={(v) => set({ fill: v })} />}
          {node.type === "image" && <Field label="URL" value={node.src.startsWith("data:") ? "(data URI)" : node.src} onCommit={(v) => set({ src: v })} />}
          <Field label="Opacidade" type="number" value={node.opacity} min={0} max={1} onCommit={(v) => num(v) !== undefined && set({ opacity: num(v) })} />
          <label className={ui.field()}>
            <span>Visível</span>
            <select value={String(node.visible)} onChange={(e) => set({ visible: e.target.value === "true" })}>
              <option value="true">sim</option>
              <option value="false">não</option>
            </select>
          </label>
        </div>
      </InspectorSection>
      {Object.keys(ov).length > 0 && (
        <div className={ui.actions}>
          <button onClick={() => set(Object.fromEntries(Object.keys(ov).map((k) => [k, null])))}>Restaurar do componente</button>
        </div>
      )}
      <p className={ui.muted}>Posição, tamanho e estrutura vêm do componente.</p>
    </div>
  );
}

function PagePanel({ doc, page, apply }: { doc: Document; page: PageNode; apply(ops: Op[], label?: string): void }) {
  const set = (props: Record<string, unknown>, label = "editar página") => apply([{ op: "update", id: page.id, props }], label);
  return (
    <div className={ui.section} key={page.id}>
      <h2 className={ui.h2}>
        page <code className={ui.muted}>#{page.id}</code>
      </h2>
      <div className={ui.grid}>
        <Field label="Nome" value={page.name} onCommit={(v) => set({ name: v }, "renomear página")} />
      </div>
      <InspectorSection id="page-theme" title="Fundo e tema" defaultOpen>
        <ColorField doc={doc} mode={page.mode} label="Fundo" value={page.fill} onCommit={(v) => set({ fill: v })} />
        <ModeField doc={doc} value={page.mode} onCommit={(v) => set({ mode: v }, "modo de tema")} />
      </InspectorSection>
      <InspectorSection id="notes" title="Notas">
        <Field label="Notas" type="textarea" value={page.notes} onCommit={(v) => set({ notes: v || null })} />
      </InspectorSection>
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
    <div className={ui.section} key={group.id}>
      <h2 className={ui.h2}>
        group <code className={ui.muted}>#{group.id}</code>
      </h2>
      <div className={ui.grid}>
        <Field label="Nome" value={group.name} onCommit={(v) => set({ name: v }, "renomear")} />
      </div>
      <InspectorSection id="position" title="Posição" defaultOpen>
        <div className={ui.grid2}>
          <Field label="X" type="number" value={group.x} onCommit={setNum("x")} />
          <Field label="Y" type="number" value={group.y} onCommit={setNum("y")} />
          <Field label="Opacidade" type="number" value={group.opacity} min={0} max={1} onCommit={setNum("opacity")} />
        </div>
        <p className={ui.muted}>
          {group.width} × {group.height}: a caixa segue os {group.children.length} filho(s). Duplo clique no canvas seleciona um filho.
        </p>
        <div className={ui.actions}>
          <button onClick={a.ungroup} title="Desagrupar (Ctrl+Shift+G)">
            Desagrupar
          </button>
        </div>
      </InspectorSection>
      <ArrangeSection ids={[group.id]} apply={props.apply} />
      <InspectorSection id="notes" title="Notas para agentes">
        <Field label="Notas" type="textarea" value={group.notes} onCommit={(v) => set({ notes: v || null })} />
      </InspectorSection>
    </div>
  );
}

function DocumentPanel({ doc, apply, activity, onSelect }: { doc: Document; apply(ops: Op[], label?: string): void; activity: ActivityEntry[]; onSelect(id: string): void }) {
  const [newToken, setNewToken] = useState("");
  const [newModeToken, setNewModeToken] = useState("");
  const issues = lintDocument(doc).filter((i) => i.severity !== "info");
  return (
    <div className={ui.section}>
      <h2 className={ui.h2}>Workspace</h2>
      <div className={ui.grid}>
        <Field label="Nome" value={doc.name} onCommit={(v) => v.trim() && apply([{ op: "rename_document", name: v.trim() }], "renomear workspace")} />
      </div>
      <InspectorSection id="tokens" title="Tokens">
        <div className={ui.grid}>
        {Object.entries(doc.tokens).map(([k, v]) => (
          <div className="flex items-center gap-1.5 [&>label]:flex-1" key={k}>
            {typeof v === "string" && /^#|^rgb/.test(v) && <span className="size-4 flex-none rounded-sm border border-line" style={{ background: v }} />}
            <Field label={`$${k}`} value={v} onCommit={(nv) => apply([{ op: "set_tokens", tokens: { [k]: nv === "" ? null : tokenValue(nv) } }], "token")} />
          </div>
        ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const token = parseTokenAssignment(newToken);
            if (!token) return;
            apply([{ op: "set_tokens", tokens: { [token.name]: tokenValue(token.value.trim()) } }], "token");
            setNewToken("");
          }}
        >
          <input className={tokenAdd} aria-label="Novo token" placeholder="nome = #e8553d" value={newToken} onChange={(e) => setNewToken(e.target.value)} />
        </form>
        </div>
      </InspectorSection>
      <InspectorSection id="modes" title="Modos de tema">
        <div className={ui.grid} data-testid="theme-modes">
        {Object.entries(doc.modes ?? {}).map(([mode, tokens]) =>
          Object.entries(tokens).map(([k, v]) => (
            <div className="flex items-center gap-1.5 [&>label]:flex-1" key={`${mode}/${k}`}>
              {typeof v === "string" && /^#|^rgb/.test(v) && <span className="size-4 flex-none rounded-sm border border-line" style={{ background: v }} />}
              <Field
                label={`${mode} · $${k}`}
                value={v}
                onCommit={(nv) => apply([{ op: "set_tokens", mode, tokens: { [k]: nv === "" ? null : tokenValue(nv) } }], "token do modo")}
              />
            </div>
          )),
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const token = parseModeTokenAssignment(newModeToken);
            if (!token) return;
            apply([{ op: "set_tokens", mode: token.mode, tokens: { [token.name]: tokenValue(token.value.trim()) } }], "token do modo");
            setNewModeToken("");
          }}
        >
          <input className={tokenAdd} aria-label="Novo token de modo" placeholder="dark: bg = #14161f" value={newModeToken} onChange={(e) => setNewModeToken(e.target.value)} />
        </form>
        </div>
      </InspectorSection>
      <InspectorSection
        id="review"
        title="Revisão"
        badge={issues.length > 0 ? <span className="rounded-full bg-accent-strong px-1.5 py-0 text-2xs text-white">{issues.length}</span> : undefined}
      >
        {issues.length === 0 ? (
          <p className={ui.muted}>Sem problemas de contraste, overflow ou tokens.</p>
        ) : (
          <ul className={list}>
            {issues.slice(0, 30).map((i, k) => (
              <li key={k} className={cx("rounded-md border-l-3 bg-panel-2", SEVERITY[i.severity] ?? "border-l-muted")}>
                <button type="button" className="w-full cursor-pointer border-0 bg-transparent px-2 py-1.5 text-left" onClick={() => onSelect(i.nodeId)}>
                  <strong>{i.rule}</strong> {i.message}
                </button>
              </li>
            ))}
          </ul>
        )}
      </InspectorSection>
      <InspectorSection id="activity" title="Atividade">
        <Activity activity={activity} />
      </InspectorSection>
    </div>
  );
}
