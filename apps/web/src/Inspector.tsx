import { useState } from "react";
import { Bot } from "lucide-react";
import {
  copyOwner,
  groupOps,
  ignoresLayout,
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
import { FontPicker } from "./FontPicker";
import { ColorField, Field, ModeField, SelectField, num, size } from "./inspector/fields";
import { InspectorSection } from "./inspector/InspectorSection";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Hint } from "./components/ui/tooltip";
import { useT } from "./i18n";
import { cn } from "./lib/cn";
import { ui } from "./ui";

export { parseModeTokenAssignment, parseTokenAssignment, tokenValue } from "./inspector/tokenParsing";
import { parseModeTokenAssignment, parseTokenAssignment, tokenValue } from "./inspector/tokenParsing";

const list = "m-0 grid list-none gap-1 p-0";
const actions = "mx-0 my-2 flex flex-wrap gap-1.5";
const SEVERITY: Record<string, string> = { error: "border-l-ui-primary", warning: "border-l-warn" };
const ALIGN_OPTS = [
  { value: "left", label: "esquerda" },
  { value: "center", label: "centro" },
  { value: "right", label: "direita" },
] as const;
const SIDE_OPTS = [
  { value: "auto", label: "automático" },
  { value: "top", label: "cima" },
  { value: "right", label: "direita" },
  { value: "bottom", label: "baixo" },
  { value: "left", label: "esquerda" },
] as const;
const YES_NO = [
  { value: "true", label: "sim" },
  { value: "false", label: "não" },
] as const;
const STROKE_STYLE_OPTS = [
  { value: "solid", label: "sólido" },
  { value: "dashed", label: "tracejado" },
  { value: "dotted", label: "pontilhado" },
] as const;
const STROKE_POS_OPTS = [
  { value: "inside", label: "dentro" },
  { value: "center", label: "centro" },
  { value: "outside", label: "fora" },
] as const;

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
        groupOps(doc, ids);
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

function flowParent(doc: Document, node: Node): boolean {
  const p = node.parentId ? doc.nodes[node.parentId] : undefined;
  return p?.type === "frame" && !!p.layout && p.layout.mode !== "none";
}

function IgnoreLayoutToggle({ doc, node, set }: { doc: Document; node: Node; set: (props: Record<string, unknown>, label?: string) => void }) {
  if (!flowParent(doc, node) || node.type === "page" || node.type === "connector") return null;
  const on = ignoresLayout(node);
  return (
    <>
      <div className="col-span-2 flex items-center justify-between gap-2 py-0.5">
        <span className="text-sm text-ui-foreground">Ignorar layout</span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Ignorar layout"
          data-testid="ignore-layout"
          className={cn(
            "relative h-5 w-9 shrink-0 cursor-pointer rounded-full border-0 p-0.5 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-ring",
            on ? "bg-ui-primary" : "bg-ui-muted",
          )}
          onClick={() => set({ layoutPositioning: on ? null : "absolute" }, "ignorar layout")}
        >
          <span aria-hidden className={cn("block size-4 rounded-full bg-white transition-transform", on && "translate-x-4")} />
        </button>
      </div>
      <p className={cn(ui.muted, "col-span-2 m-0")}>{on ? "Fora do fluxo. x/y relativos ao pai." : "No fluxo: gap e hug contam este filho."}</p>
    </>
  );
}

const Z_LABEL: Record<"front" | "back" | "forward" | "backward", string> = {
  front: "trazer para frente",
  forward: "avançar",
  backward: "recuar",
  back: "enviar para fundo",
};

function ArrangeSection({ ids, apply }: { ids: string[]; apply: Props["apply"] }) {
  const m = useT();
  const run = (index: keyof typeof Z_LABEL) =>
    apply(
      ids.map((id) => ({ op: "update", id, props: { index } })),
      Z_LABEL[index],
    );
  return (
    <InspectorSection id="arrange" title={m.arrange} defaultOpen>
      <div className={actions} data-testid="arrange-actions">
        <Hint label={`${m.bringToFront} (Ctrl+Page Up)`}>
          <Button type="button" variant="secondary" size="sm" data-testid="arrange-front" onClick={() => run("front")}>
            {m.bringToFront}
          </Button>
        </Hint>
        <Hint label={`${m.bringForward} (Page Up)`}>
          <Button type="button" variant="secondary" size="sm" data-testid="arrange-forward" onClick={() => run("forward")}>
            {m.bringForward}
          </Button>
        </Hint>
        <Hint label={`${m.sendBackward} (Page Down)`}>
          <Button type="button" variant="secondary" size="sm" data-testid="arrange-backward" onClick={() => run("backward")}>
            {m.sendBackward}
          </Button>
        </Hint>
        <Hint label={`${m.sendToBack} (Ctrl+Page Down)`}>
          <Button type="button" variant="secondary" size="sm" data-testid="arrange-back" onClick={() => run("back")}>
            {m.sendToBack}
          </Button>
        </Hint>
      </div>
    </InspectorSection>
  );
}

export function Inspector(props: Props) {
  const m = useT();
  const { doc, node, selected, apply, activity, onSelect } = props;
  if (selected.length > 1) {
    const a = structureActions(doc, selected, props);
    return (
      <div className={ui.section} data-testid="multi-selection">
        <h2 className={ui.h2}>{m.selectedNodes(selected.length)}</h2>
        <div className={actions}>
          <Hint label={`${m.groupNodes} (Ctrl+G)`}>
            <Button type="button" variant="secondary" size="sm" onClick={a.group}>
              {m.groupNodes}
            </Button>
          </Hint>
          {a.canUngroup && (
            <Hint label={`${m.ungroupNodes} (Ctrl+Shift+G)`}>
              <Button type="button" variant="secondary" size="sm" onClick={a.ungroup}>
                {m.ungroupNodes}
              </Button>
            </Hint>
          )}
        </div>
        <ArrangeSection ids={selected} apply={apply} />
        <p className={ui.muted}>{m.multiSelectionHint}</p>
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
          <IgnoreLayoutToggle doc={doc} node={node} set={set} />
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
            onCommit={(v) =>
              set({
                stroke: v
                  ? {
                      color: v,
                      width: node.stroke?.width ?? 1,
                      style: node.stroke?.style ?? "solid",
                      position: node.stroke?.position ?? (node.type === "path" ? "center" : "inside"),
                    }
                  : null,
              })
            }
          />
          {node.stroke && (
            <>
              <Field
                label="Espessura"
                type="number"
                value={node.stroke.width}
                min={0}
                onCommit={(v) => num(v) !== undefined && set({ stroke: { ...node.stroke!, width: num(v) } })}
              />
              <SelectField
                label="Estilo"
                value={node.stroke.style ?? "solid"}
                testId="stroke-style"
                onChange={(v) => set({ stroke: { ...node.stroke!, style: v } })}
                options={STROKE_STYLE_OPTS}
              />
              <SelectField
                label="Posição"
                value={node.stroke.position ?? (node.type === "path" ? "center" : "inside")}
                testId="stroke-position"
                onChange={(v) => set({ stroke: { ...node.stroke!, position: v } })}
                options={STROKE_POS_OPTS}
              />
            </>
          )}
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
            <SelectField label="Alinhamento" value={node.textAlign} onChange={(v) => set({ textAlign: v })} options={ALIGN_OPTS} />
          </div>
          <FontPicker doc={doc} value={node.fontFamily} onCommit={(v) => set({ fontFamily: v })} />
        </InspectorSection>
      )}

      {node.type === "shape" && (
        <InspectorSection id="shape" title="Forma" defaultOpen>
          <div className={ui.grid}>
            <SelectField
              label="Tipo"
              value={node.shape}
              testId="shape-kind"
              onChange={(v) => set({ shape: v }, "trocar forma")}
              options={[
                { value: "rect", label: "caixa" },
                { value: "ellipse", label: "oval" },
                { value: "diamond", label: "losango (decisão)" },
                { value: "triangle", label: "triângulo" },
                { value: "note", label: "nota adesiva" },
              ]}
            />
            <Field label="Texto" type="textarea" value={node.text} title="Duplo clique na forma edita o texto no canvas" onCommit={(v) => set({ text: v }, "editar texto")} />
            <ColorField doc={doc} mode={themeMode} label="Cor do texto" value={node.color} onCommit={(v) => v && set({ color: v })} />
          </div>
          <div className={ui.grid2}>
            <Field label="Tamanho" value={node.fontSize} onCommit={(v) => set({ fontSize: v.startsWith("$") ? v : num(v) })} />
            <Field label="Peso" type="number" value={node.fontWeight} min={100} max={900} integer onCommit={setNum("fontWeight")} />
            <SelectField label="Alinhamento" value={node.textAlign} onChange={(v) => set({ textAlign: v })} options={ALIGN_OPTS} />
          </div>
        </InspectorSection>
      )}

      {node.type === "frame" && (
        <>
          <InspectorSection id="frame-component" title="Componente" defaultOpen>
            <div className={actions} data-testid="component-actions">
              {node.component ? (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      const id = newId();
                      const w = typeof node.width === "number" ? node.width : 0;
                      apply([{ op: "create", parentId: node.parentId, node: { type: "frame", id, name: node.name, instanceOf: node.id, x: node.x + w + 40, y: node.y } }], "criar instância");
                      props.onSelectMany([id]);
                    }}
                  >
                    Nova instância
                  </Button>
                  <Button type="button" variant="secondary" size="sm" onClick={() => set({ component: null }, "deixar de ser componente")}>
                    Deixar de ser componente
                  </Button>
                </>
              ) : (
                <Button type="button" variant="secondary" size="sm" onClick={() => set({ component: true }, "criar componente")}>
                  Tornar componente
                </Button>
              )}
            </div>
          </InspectorSection>
          <InspectorSection id="frame-theme" title="Modo de tema" defaultOpen>
            <ModeField doc={doc} value={node.mode} inherited={modeOf(doc, node.parentId ? doc.nodes[node.parentId] : undefined)} onCommit={(v) => set({ mode: v }, "modo de tema")} />
          </InspectorSection>
          <InspectorSection id="frame-layout" title="Layout auto" defaultOpen={!!node.layout?.mode && node.layout.mode !== "none"}>
            <div className={ui.grid2}>
              <SelectField
                label="Modo"
                value={node.layout?.mode ?? "none"}
                onChange={(v) => set({ layout: v === "none" ? null : { ...(node.layout ?? {}), mode: v } }, "layout")}
                options={[
                  { value: "none", label: "livre" },
                  { value: "row", label: "linha" },
                  { value: "column", label: "coluna" },
                ]}
              />
              <SelectField label="Recortar" value={String(node.clip)} onChange={(v) => set({ clip: v === "true" })} options={YES_NO} />
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
                  <SelectField
                    label="Alinhar"
                    value={node.layout.align}
                    onChange={(v) => set({ layout: { ...node.layout, align: v } })}
                    options={["start", "center", "end", "stretch"].map((o) => ({ value: o, label: o }))}
                  />
                  <SelectField
                    label="Distribuir"
                    value={node.layout.justify}
                    onChange={(v) => set({ layout: { ...node.layout, justify: v } })}
                    options={["start", "center", "end", "between"].map((o) => ({ value: o, label: o }))}
                  />
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
            <SelectField
              label="Regra"
              value={node.fillRule}
              onChange={(v) => set({ fillRule: v })}
              options={[
                { value: "nonzero", label: "nonzero" },
                { value: "evenodd", label: "evenodd" },
              ]}
            />
            <SelectField
              label="Ponta"
              value={node.strokeCap}
              onChange={(v) => set({ strokeCap: v })}
              options={["butt", "round", "square"].map((o) => ({ value: o, label: o }))}
            />
            <SelectField
              label="Junção"
              value={node.strokeJoin}
              onChange={(v) => set({ strokeJoin: v })}
              options={["miter", "round", "bevel"].map((o) => ({ value: o, label: o }))}
            />
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
        de{" "}
        <Button type="button" variant="link" size="xs" className="h-auto p-0" onClick={() => onSelect(node.instanceOf)}>
          {comp?.name || node.instanceOf}
        </Button>
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
          <IgnoreLayoutToggle doc={doc} node={node} set={set} />
        </div>
      </InspectorSection>
      <InspectorSection id="instance-fill" title="Preenchimento">
        <ColorField doc={doc} label="Preenchimento" value={node.fill} onCommit={(v) => set({ fill: v }, "override")} />
      </InspectorSection>
      <ArrangeSection ids={[node.id]} apply={apply} />
      <div className={actions}>
        <Button type="button" variant="secondary" size="sm" onClick={() => onSelect(node.instanceOf)}>
          Ir para o componente
        </Button>
        {overrides > 0 && (
          <Button type="button" variant="secondary" size="sm" onClick={() => set({ overrides: null }, "limpar overrides")}>
            Limpar overrides
          </Button>
        )}
        <Button type="button" variant="secondary" size="sm" onClick={() => apply([{ op: "detach", ids: [node.id] }], "desanexar instância")}>
          Desanexar
        </Button>
      </div>
      <InspectorSection id="notes" title="Notas para agentes">
        <Field label="Notas" type="textarea" value={node.notes} onCommit={(v) => set({ notes: v || null })} />
      </InspectorSection>
    </div>
  );
}

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
          {label}:{" "}
          <Button type="button" variant="link" size="xs" className="h-auto p-0" onClick={() => onSelect(e.nodeId!)}>
            {doc.nodes[e.nodeId]?.name || `#${e.nodeId}`}
          </Button>
        </p>
        <SelectField
          label="Lado"
          value={e.side ?? "auto"}
          testId={`connector-${key}-side`}
          onChange={(v) => set({ [key]: { nodeId: e.nodeId, side: v } })}
          options={SIDE_OPTS}
        />
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
          <SelectField
            label="Rota"
            value={node.route}
            testId="connector-route"
            onChange={(v) => set({ route: v })}
            options={[
              { value: "straight", label: "reta" },
              { value: "elbow", label: "cotovelo" },
              { value: "rounded", label: "arredondado" },
              { value: "curve", label: "curva" },
            ]}
          />
          {node.route === "rounded" && (
            <div data-testid="connector-radius">
              <Field label="Raio" type="number" value={node.radius} min={0} onCommit={(v) => num(v) !== undefined && set({ radius: num(v) })} />
            </div>
          )}
          <SelectField label="Tracejado" value={String(node.dashed)} onChange={(v) => set({ dashed: v === "true" })} options={YES_NO} />
          {node.route === "curve" && <p className={ui.muted}>Arraste a alça no canvas para curvar a seta.</p>}
          <SelectField
            label="Seta no início"
            value={node.startArrow}
            onChange={(v) => set({ startArrow: v })}
            options={[
              { value: "none", label: "nenhuma" },
              { value: "arrow", label: "seta" },
            ]}
          />
          <SelectField
            label="Seta no fim"
            value={node.endArrow}
            onChange={(v) => set({ endArrow: v })}
            options={[
              { value: "none", label: "nenhuma" },
              { value: "arrow", label: "seta" },
            ]}
          />
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
        cópia de{" "}
        <Button type="button" variant="link" size="xs" className="h-auto p-0" onClick={() => onSelect(src)}>
          #{src}
        </Button>{" "}
        na instância{" "}
        <Button type="button" variant="link" size="xs" className="h-auto p-0" onClick={() => onSelect(instance.id)}>
          {instance.name || instance.id}
        </Button>
      </p>
      <InspectorSection id="copy-appearance" title="Aparência" defaultOpen>
        <div className={ui.grid}>
          {node.type === "text" && <Field label="Conteúdo" type="textarea" value={node.text} onCommit={(v) => set({ text: v })} />}
          {node.type === "text" && <ColorField doc={doc} label="Cor" value={node.color} onCommit={(v) => set({ color: v })} />}
          {node.type !== "group" && node.type !== "connector" && <ColorField doc={doc} label="Preenchimento" value={node.fill} onCommit={(v) => set({ fill: v })} />}
          {node.type === "image" && <Field label="URL" value={node.src.startsWith("data:") ? "(data URI)" : node.src} onCommit={(v) => set({ src: v })} />}
          <Field label="Opacidade" type="number" value={node.opacity} min={0} max={1} onCommit={(v) => num(v) !== undefined && set({ opacity: num(v) })} />
          <SelectField label="Visível" value={String(node.visible)} onChange={(v) => set({ visible: v === "true" })} options={YES_NO} />
        </div>
      </InspectorSection>
      {Object.keys(ov).length > 0 && (
        <div className={actions}>
          <Button type="button" variant="secondary" size="sm" onClick={() => set(Object.fromEntries(Object.keys(ov).map((k) => [k, null])))}>
            Restaurar do componente
          </Button>
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
          <IgnoreLayoutToggle doc={props.doc} node={group} set={set} />
        </div>
        <p className={ui.muted}>
          {group.width} × {group.height}: a caixa segue os {group.children.length} filho(s). Duplo clique no canvas seleciona um filho.
        </p>
        <div className={actions}>
          <Hint label="Desagrupar (Ctrl+Shift+G)">
            <Button type="button" variant="secondary" size="sm" onClick={a.ungroup}>
              Desagrupar
            </Button>
          </Hint>
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
            <div className="flex items-center gap-1.5 [&>div]:flex-1" key={k}>
              {typeof v === "string" && /^#|^rgb/.test(v) && <span className="size-4 flex-none rounded-sm border border-ui-border" style={{ background: v }} />}
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
            <Input className="h-7 border-dashed" aria-label="Novo token" placeholder="nome = #e8553d" value={newToken} onChange={(e) => setNewToken(e.target.value)} />
          </form>
        </div>
      </InspectorSection>
      <InspectorSection id="modes" title="Modos de tema">
        <div className={ui.grid} data-testid="theme-modes">
          {Object.entries(doc.modes ?? {}).map(([mode, tokens]) =>
            Object.entries(tokens).map(([k, v]) => (
              <div className="flex items-center gap-1.5 [&>div]:flex-1" key={`${mode}/${k}`}>
                {typeof v === "string" && /^#|^rgb/.test(v) && <span className="size-4 flex-none rounded-sm border border-ui-border" style={{ background: v }} />}
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
            <Input className="h-7 border-dashed" aria-label="Novo token de modo" placeholder="dark: bg = #14161f" value={newModeToken} onChange={(e) => setNewModeToken(e.target.value)} />
          </form>
        </div>
      </InspectorSection>
      <InspectorSection
        id="review"
        title="Revisão"
        badge={issues.length > 0 ? <span className="rounded-full bg-ui-primary px-1.5 py-0 text-2xs text-ui-primary-foreground">{issues.length}</span> : undefined}
      >
        {issues.length === 0 ? (
          <p className={ui.muted}>Sem problemas de contraste, overflow ou tokens.</p>
        ) : (
          <ul className={list}>
            {issues.slice(0, 30).map((i, k) => (
              <li key={k} className={cn("rounded-md border-l-3 bg-ui-muted", SEVERITY[i.severity] ?? "border-l-ui-muted-foreground")}>
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
