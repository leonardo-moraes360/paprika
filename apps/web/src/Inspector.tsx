import { useState } from "react";
import {
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignHorizontalSpaceBetween,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalSpaceBetween,
  Bot,
  Frame,
  Link2,
  Unlink,
  type LucideIcon,
} from "lucide-react";
import {
  alignOps,
  copyOwner,
  distributeOps,
  groupOps,
  ignoresLayout,
  isInstance,
  lintDocument,
  newId,
  modeOf,
  owningComponent,
  ungroupOps,
  wrapOps,
  type AlignEdge,
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
import { EffectsSection } from "./inspector/EffectsSection";
import { ColorField, Field, ModeField, SelectField, num, size } from "./inspector/fields";
import { GradientField } from "./inspector/gradient";
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

function isCornerList(radius: number | string | readonly (number | string)[]): radius is readonly (number | string)[] {
  return Array.isArray(radius);
}

function RadiusCorners({
  radius,
  onChange,
}: {
  radius: number | string | readonly (number | string)[];
  onChange(next: number | string | (number | string)[]): void;
}) {
  const cornerFields = [
    ["TL", 0, "Canto superior esquerdo"],
    ["TR", 1, "Canto superior direito"],
    ["BL", 3, "Canto inferior esquerdo"],
    ["BR", 2, "Canto inferior direito"],
  ] as const;
  if (isCornerList(radius)) {
    const corners = [...radius];
    const commitAt = (i: number, raw: string) => {
      const n = num(raw);
      if (n === undefined || n < 0) return;
      const next = [...corners];
      next[i] = n;
      onChange(next);
    };
    return (
      <div className="flex items-start gap-1" data-testid="radius-corners" data-state="unlinked">
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-1">
          {cornerFields.map(([label, i, title]) => (
            <div key={label} data-testid={`radius-${label.toLowerCase()}`}>
              <Field label={label} title={title} type="number" value={corners[i]} min={0} onCommit={(v) => commitAt(i, v)} />
            </div>
          ))}
        </div>
        <Hint label="Ligar cantos">
          <Button type="button" variant="secondary" size="icon" className="size-7 shrink-0" data-testid="radius-link" aria-label="Ligar cantos" aria-pressed onClick={() => onChange(corners[0] ?? 0)}>
            <Unlink aria-hidden />
          </Button>
        </Hint>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-1" data-testid="radius-corners" data-state="linked">
      <div className="min-w-0 flex-1">
        <Field label="Raio" type="number" value={radius} min={0} onCommit={(v) => num(v) !== undefined && onChange(num(v)!)} />
      </div>
      <Hint label="Desligar cantos">
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className="size-7 shrink-0"
          data-testid="radius-link"
          aria-label="Desligar cantos"
          aria-pressed={false}
          onClick={() => onChange([radius, radius, radius, radius])}
        >
          <Link2 aria-hidden />
        </Button>
      </Hint>
    </div>
  );
}
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

const ALIGN_EDGES: { edge: AlignEdge; labelKey: "alignLeft" | "alignCenter" | "alignRight" | "alignTop" | "alignMiddle" | "alignBottom"; icon: LucideIcon }[] = [
  { edge: "left", labelKey: "alignLeft", icon: AlignHorizontalJustifyStart },
  { edge: "center", labelKey: "alignCenter", icon: AlignHorizontalJustifyCenter },
  { edge: "right", labelKey: "alignRight", icon: AlignHorizontalJustifyEnd },
  { edge: "top", labelKey: "alignTop", icon: AlignVerticalJustifyStart },
  { edge: "middle", labelKey: "alignMiddle", icon: AlignVerticalJustifyCenter },
  { edge: "bottom", labelKey: "alignBottom", icon: AlignVerticalJustifyEnd },
];

function AlignSection({ ids, doc, apply, onError }: { ids: string[]; doc: Document; apply: Props["apply"]; onError: Props["onError"] }) {
  const m = useT();
  const run = (f: () => void) => {
    try {
      f();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <InspectorSection id="align" title={m.alignSection} defaultOpen>
      <div className={actions} data-testid="align-actions">
        {ALIGN_EDGES.map(({ edge, labelKey, icon: Icon }) => (
          <Hint key={edge} label={m[labelKey]}>
            <Button type="button" variant="secondary" size="icon" className="size-7" aria-label={m[labelKey]} data-testid={`align-${edge}`} onClick={() => run(() => { if (alignOps(doc, ids, edge).ops.length) apply([{ op: "align", ids, edge }], m[labelKey]); })}>
              <Icon aria-hidden />
            </Button>
          </Hint>
        ))}
        <Hint label={m.distributeHorizontal}>
          <Button type="button" variant="secondary" size="icon" className="size-7" aria-label={m.distributeHorizontal} data-testid="distribute-horizontal" disabled={ids.length < 3} onClick={() => run(() => { if (distributeOps(doc, ids, "horizontal").ops.length) apply([{ op: "distribute", ids, axis: "horizontal" }], m.distributeHorizontal); })}>
            <AlignHorizontalSpaceBetween aria-hidden />
          </Button>
        </Hint>
        <Hint label={m.distributeVertical}>
          <Button type="button" variant="secondary" size="icon" className="size-7" aria-label={m.distributeVertical} data-testid="distribute-vertical" disabled={ids.length < 3} onClick={() => run(() => { if (distributeOps(doc, ids, "vertical").ops.length) apply([{ op: "distribute", ids, axis: "vertical" }], m.distributeVertical); })}>
            <AlignVerticalSpaceBetween aria-hidden />
          </Button>
        </Hint>
      </div>
    </InspectorSection>
  );
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
    wrap: () =>
      run(() => {
        const id = newId();
        wrapOps(doc, ids);
        props.apply([{ op: "wrap", ids, id }], "envolver em frame");
        props.onSelectMany([id]);
      }),
  };
}

function flowParent(doc: Document, node: Node): boolean {
  const p = node.parentId ? doc.nodes[node.parentId] : undefined;
  return p?.type === "frame" && !!p.layout && p.layout.mode !== "none";
}

function showsConstraints(doc: Document, node: Node): boolean {
  if (node.type === "page" || node.type === "connector") return false;
  const parent = node.parentId ? doc.nodes[node.parentId] : undefined;
  if (!parent || parent.type !== "frame" || isInstance(parent)) return false;
  return !flowParent(doc, node) || ignoresLayout(node);
}

function constraintNow(node: Node): { horizontal: "left" | "right" | "center" | "scale"; vertical: "top" | "bottom" | "center" | "scale" } {
  if ("constraints" in node && node.constraints) return { horizontal: node.constraints.horizontal, vertical: node.constraints.vertical };
  return { horizontal: "left", vertical: "top" };
}

function ConstraintsFields({ doc, node, set }: { doc: Document; node: Node; set: (props: Record<string, unknown>, label?: string) => void }) {
  const m = useT();
  if (!showsConstraints(doc, node)) return null;
  const cur = constraintNow(node);
  const axes = [
    {
      key: "horizontal" as const,
      label: m.constraintHorizontal,
      test: "h",
      options: [
        ["left", m.constraintLeft],
        ["center", m.constraintCenter],
        ["right", m.constraintRight],
        ["scale", m.constraintScale],
      ] as const,
    },
    {
      key: "vertical" as const,
      label: m.constraintVertical,
      test: "v",
      options: [
        ["top", m.constraintTop],
        ["center", m.constraintCenter],
        ["bottom", m.constraintBottom],
        ["scale", m.constraintScale],
      ] as const,
    },
  ];
  return (
    <div className="col-span-2 grid gap-1" data-testid="constraints">
      {axes.map((axis) => (
        <div key={axis.key} className="grid gap-1">
          <span className="text-xs text-ui-muted-foreground">{axis.label}</span>
          <div className="grid grid-cols-4 gap-1" role="group" aria-label={axis.label}>
            {axis.options.map(([value, label]) => {
              const on = cur[axis.key] === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={on}
                  data-testid={`constraint-${axis.test}-${value}`}
                  className={cn(
                    "h-6 cursor-pointer rounded-md border px-1 text-xs",
                    on
                      ? "is-active border-transparent bg-ui-primary font-semibold text-ui-primary-foreground"
                      : "border-ui-border bg-ui-secondary text-ui-foreground",
                  )}
                  onClick={() => {
                    if (on) return;
                    const next = { ...cur, [axis.key]: value };
                    set({ constraints: next.horizontal === "left" && next.vertical === "top" ? null : next }, "constraints");
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <p className={cn(ui.muted, "m-0 text-xs")}>{m.constraintHint}</p>
    </div>
  );
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

const TOKEN_TYPE_LABEL: Record<string, string> = {
  color: "cor",
  length: "comprimento",
  fontFamily: "família",
  fontWeight: "peso",
  fontSize: "tamanho",
  lineHeight: "altura",
  letterSpacing: "espaçamento",
};

function tokenUses(node: Node): { field: string; label: string; value: string }[] {
  const out: { field: string; label: string; value: string }[] = [];
  const push = (field: string, label: string, value: unknown) => {
    if (typeof value === "string" && value.startsWith("$")) out.push({ field, label, value });
  };
  const rec = node as unknown as Record<string, unknown>;
  push("fill", "Preenchimento", rec.fill);
  push("color", "Cor", rec.color);
  push("fontFamily", "Família", rec.fontFamily);
  push("fontSize", "Tamanho", rec.fontSize);
  push("fontWeight", "Peso", rec.fontWeight);
  push("lineHeight", "Altura de linha", rec.lineHeight);
  push("letterSpacing", "Espaçamento", rec.letterSpacing);
  if (Array.isArray(rec.radius)) (rec.radius as unknown[]).forEach((item, i) => push("radius", `Raio ${i + 1}`, item));
  else push("radius", "Raio", rec.radius);
  const stroke = rec.stroke as { color?: unknown; width?: unknown } | undefined;
  if (stroke) {
    push("stroke.color", "Borda", stroke.color);
    push("stroke.width", "Espessura", stroke.width);
  }
  const shadows = Array.isArray(rec.shadow) ? rec.shadow : rec.shadow ? [rec.shadow] : [];
  for (const shadow of shadows as { x?: unknown; y?: unknown; blur?: unknown; spread?: unknown; color?: unknown }[]) {
    push("shadow.x", "Sombra X", shadow.x);
    push("shadow.y", "Sombra Y", shadow.y);
    push("shadow.blur", "Sombra blur", shadow.blur);
    push("shadow.spread", "Sombra spread", shadow.spread);
    push("shadow.color", "Sombra cor", shadow.color);
  }
  const outline = rec.outline as { color?: unknown; width?: unknown; offset?: unknown } | undefined;
  if (outline) {
    push("outline.color", "Contorno", outline.color);
    push("outline.width", "Contorno espessura", outline.width);
    push("outline.offset", "Contorno offset", outline.offset);
  }
  const filter = rec.filter as { blur?: unknown } | undefined;
  const backdrop = rec.backdropFilter as { blur?: unknown } | undefined;
  if (filter) push("filter.blur", "Filtro blur", filter.blur);
  if (backdrop) push("backdropFilter.blur", "Fundo blur", backdrop.blur);
  const layout = rec.layout as { gap?: unknown; padding?: unknown } | undefined;
  if (layout) {
    push("layout.gap", "Gap", layout.gap);
    if (Array.isArray(layout.padding)) (layout.padding as unknown[]).forEach((item) => push("layout.padding", "Padding", item));
    else push("layout.padding", "Padding", layout.padding);
  }
  return out;
}

function TokenDetach({ id, node, apply }: { id: string; node: Node; apply: Props["apply"] }) {
  const uses = tokenUses(node);
  if (uses.length === 0) return null;
  const detach = (fields?: string[]) => apply([{ op: "detach_tokens", ids: [id], ...(fields ? { fields } : {}) }], "desvincular token");
  return (
    <InspectorSection id="node-tokens" title="Tokens" defaultOpen>
      <div className={ui.grid} data-testid="node-tokens">
        {uses.map((use, i) => (
          <div className="flex items-center justify-between gap-2" key={`${use.field}-${i}`}>
            <span className="min-w-0 truncate text-sm text-ui-foreground">
              {use.label} <code className={ui.muted}>{use.value}</code>
            </span>
            <Button type="button" variant="secondary" size="sm" aria-label={`Desvincular ${use.label}`} onClick={() => detach([use.field])}>
              <Unlink aria-hidden />
              Desvincular
            </Button>
          </div>
        ))}
        <Button type="button" size="sm" data-testid="detach-tokens" onClick={() => detach()}>
          Desvincular tokens deste nó
        </Button>
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
          <Hint label={`${m.wrapInFrame} (Ctrl+Alt+G)`}>
            <Button type="button" variant="default" size="sm" data-testid="wrap-frame" onClick={a.wrap}>
              <Frame aria-hidden />
              {m.wrapInFrame}
            </Button>
          </Hint>
        </div>
        <AlignSection ids={selected} doc={doc} apply={apply} onError={props.onError} />
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
  const setTokenNum = (key: string) => (v: string) => {
    const t = v.trim();
    if (t.startsWith("$")) set({ [key]: t });
    else if (num(t) !== undefined) set({ [key]: num(t) });
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
          <ConstraintsFields doc={doc} node={node} set={set} />
        </div>
      </InspectorSection>
      <InspectorSection id="appearance" title="Preenchimento e traço">
        <div className={ui.grid}>
          <GradientField doc={doc} node={node} mode={themeMode} onChange={(props) => set(props)} />
          {!node.gradient && <ColorField doc={doc} mode={themeMode} label={m.fill} value={node.fill} onCommit={(v) => set({ fill: v })} />}
          {(node.type === "frame" || node.type === "rect" || node.type === "image") && (
            <RadiusCorners radius={node.radius} onChange={(radius) => set({ radius })} />
          )}
          {node.type !== "ellipse" && node.type !== "path" && node.type !== "frame" && node.type !== "rect" && node.type !== "image" && (
            <Field label="Raio" type="number" value={node.radius} min={0} onCommit={setNum("radius")} />
          )}
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
      <EffectsSection doc={doc} node={node} mode={themeMode} set={set} />

      {node.type === "text" && (
        <InspectorSection id="text" title="Texto">
          <div className={ui.grid}>
            <Field
              label="Conteúdo"
              type="textarea"
              value={node.text}
              onCommit={(v) => set({ text: v, ...(v !== node.text && node.runs?.length ? { runs: null } : {}) }, "editar texto")}
            />
            {node.runs?.length ? <p className={ui.muted}>{node.runs.length} trechos · duplo clique no canvas</p> : null}
            <ColorField doc={doc} mode={themeMode} label="Cor" value={node.color} onCommit={(v) => v && set({ color: v })} />
          </div>
          <div className={ui.grid2}>
            <Field label="Tamanho" value={node.fontSize} onCommit={setTokenNum("fontSize")} />
            <Field label="Peso" value={node.fontWeight} title="100–900 ou $token" onCommit={setTokenNum("fontWeight")} />
            <Field label="Altura linha" value={node.lineHeight} title="número ou $token" onCommit={setTokenNum("lineHeight")} />
            <Field label="Espaçamento" value={node.letterSpacing} title="número ou $token" onCommit={setTokenNum("letterSpacing")} />
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
            <Field label="Tamanho" value={node.fontSize} onCommit={setTokenNum("fontSize")} />
            <Field label="Peso" value={node.fontWeight} title="100–900 ou $token" onCommit={setTokenNum("fontWeight")} />
            <Field label="Altura linha" value={node.lineHeight} title="número ou $token" onCommit={setTokenNum("lineHeight")} />
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
            {node.component && (
              <ComponentPropsFields
                props={node.componentProps}
                onChange={(componentProps) => set({ componentProps }, "props do componente")}
              />
            )}
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

      <TokenDetach id={node.id} node={node} apply={apply} />
      <ComponentBind doc={doc} node={node} set={set} />
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
      <InstanceValues doc={doc} instance={node} set={set} />
      <InspectorSection id="instance-transform" title="Posição e transformação" defaultOpen>
        <div className={ui.grid2}>
          <Field label="X" type="number" value={node.x} onCommit={setNum("x")} />
          <Field label="Y" type="number" value={node.y} onCommit={setNum("y")} />
          <Field label="Escala" type="number" value={node.scale ?? 1} title="0.01 a 100" min={0.01} max={100} onCommit={setNum("scale")} />
          <Field label="Rotação" type="number" value={node.rotation} onCommit={setNum("rotation")} />
          <Field label="Opacidade" type="number" value={node.opacity} min={0} max={1} onCommit={setNum("opacity")} />
          <Field label="Tamanho" value={`${node.width}×${node.height}`} onCommit={() => onError("o tamanho vem do componente; mude a escala")} />
          <IgnoreLayoutToggle doc={doc} node={node} set={set} />
          <ConstraintsFields doc={doc} node={node} set={set} />
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
      <ComponentBind doc={doc} node={node} set={set} />
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
          {node.type === "text" && (
            <Field
              label="Conteúdo"
              type="textarea"
              value={node.text}
              onCommit={(v) => set({ text: v, ...(v !== node.text && node.runs?.length ? { runs: null } : {}) })}
            />
          )}
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

type PropDecl = NonNullable<FrameNode["componentProps"]>[number];
type BindSpec = NonNullable<FrameNode["bind"]>;

function ComponentPropsFields({ props, onChange }: { props?: PropDecl[]; onChange: (next: PropDecl[]) => void }) {
  const list = props ?? [];
  const write = (next: PropDecl[]) => onChange(next);
  return (
    <div className={ui.grid} data-testid="component-props">
      {list.map((p, i) => (
        <div className={ui.grid2} key={`${p.name}-${i}`}>
          <Field label="Prop" value={p.name} onCommit={(v) => write(list.map((item, k) => (k === i ? { ...item, name: v.trim() || item.name } : item)))} />
          <SelectField
            label="Tipo"
            value={p.type}
            onChange={(v) =>
              write(
                list.map((item, k) =>
                  k === i
                    ? {
                        name: item.name,
                        type: v as PropDecl["type"],
                        ...(v === "boolean" ? { default: false } : v === "text" ? { default: "" } : { default: "md", options: ["sm", "md"] }),
                      }
                    : item,
                ),
              )
            }
            options={[
              { value: "text", label: "texto" },
              { value: "boolean", label: "boolean" },
              { value: "variant", label: "variante" },
            ]}
          />
          {p.type === "boolean" ? (
            <SelectField
              label="Padrão"
              value={String(p.default === true)}
              onChange={(v) => write(list.map((item, k) => (k === i ? { ...item, default: v === "true" } : item)))}
              options={YES_NO}
            />
          ) : (
            <Field
              label={p.type === "variant" ? "Opções" : "Padrão"}
              value={p.type === "variant" ? (p.options ?? []).join(" ") : String(p.default ?? "")}
              onCommit={(v) => {
                if (p.type === "variant") {
                  const options = v.trim().split(/[\s,]+/).filter(Boolean);
                  write(list.map((item, k) => (k === i ? { ...item, options, default: options.includes(String(item.default)) ? item.default : options[0] } : item)));
                } else {
                  write(list.map((item, k) => (k === i ? { ...item, default: v } : item)));
                }
              }}
            />
          )}
          <Button type="button" variant="secondary" size="sm" onClick={() => write(list.filter((_, k) => k !== i))}>
            Remover
          </Button>
        </div>
      ))}
      <Button type="button" variant="secondary" size="sm" onClick={() => write([...list, { name: "prop", type: "text", default: "" }])}>
        Nova prop
      </Button>
    </div>
  );
}

function ComponentBind({ doc, node, set }: { doc: Document; node: Node; set: (p: Record<string, unknown>, label?: string) => void }) {
  const owner = owningComponent(doc, node.id);
  if (!owner) return null;
  const decls = owner.componentProps ?? [];
  const bind: BindSpec = "bind" in node && node.bind ? node.bind : {};
  const write = (next: BindSpec) => {
    const clean: BindSpec = {};
    if (next.text) clean.text = next.text;
    if (next.visible) clean.visible = next.visible;
    if (next.variant && Object.keys(next.variant).length) clean.variant = next.variant;
    set({ bind: clean.text || clean.visible || clean.variant ? clean : null }, "bind");
  };
  const textProps = decls.filter((p) => p.type === "text");
  const boolProps = decls.filter((p) => p.type === "boolean");
  const variantProps = decls.filter((p) => p.type === "variant");
  const none = { value: "", label: "—" };
  return (
    <InspectorSection id="component-bind" title="Props do componente" defaultOpen>
      <div className={ui.grid2} data-testid="component-bind">
        {textProps.length > 0 && (node.type === "text" || node.type === "shape") && (
          <SelectField
            label="Texto"
            value={bind.text ?? ""}
            onChange={(v) => write({ ...bind, text: v || undefined })}
            options={[none, ...textProps.map((p) => ({ value: p.name, label: p.name }))]}
          />
        )}
        {boolProps.length > 0 && (
          <SelectField
            label="Visível"
            value={bind.visible ?? ""}
            onChange={(v) => write({ ...bind, visible: v || undefined })}
            options={[none, ...boolProps.map((p) => ({ value: p.name, label: p.name }))]}
          />
        )}
        {variantProps.map((p) => (
          <SelectField
            key={p.name}
            label={p.name}
            value={bind.variant?.[p.name] ?? ""}
            onChange={(v) => {
              const variant = { ...bind.variant };
              if (v) variant[p.name] = v;
              else delete variant[p.name];
              write({ ...bind, variant });
            }}
            options={[none, ...(p.options ?? []).map((o) => ({ value: o, label: o }))]}
          />
        ))}
        {(node.type === "frame" || node.type === "group") && (
          <Field label="Slot" value={node.slot ?? ""} onCommit={(v) => set({ slot: v.trim() || null }, "slot")} />
        )}
      </div>
    </InspectorSection>
  );
}

function componentSlotFrames(doc: Document, compId: string): { name: string; id: string }[] {
  const out: { name: string; id: string }[] = [];
  const walk = (id: string) => {
    const n = doc.nodes[id];
    if (!n || !("children" in n)) return;
    for (const c of n.children) {
      const ch = doc.nodes[c];
      if (!ch || ("sourceId" in ch && ch.sourceId)) continue;
      if ("slot" in ch && ch.slot) out.push({ name: ch.slot, id: ch.id });
      if (!isInstance(ch)) walk(c);
    }
  };
  walk(compId);
  return out;
}

function InstanceValues({
  doc,
  instance,
  set,
}: {
  doc: Document;
  instance: FrameNode & { instanceOf: string };
  set: (p: Record<string, unknown>, label?: string) => void;
}) {
  const comp = doc.nodes[instance.instanceOf];
  const decls = comp?.type === "frame" ? (comp.componentProps ?? []) : [];
  const slots = componentSlotFrames(doc, instance.instanceOf);
  const keys = Object.keys(instance.overrides ?? {});
  if (!decls.length && !slots.length && !keys.length) return null;
  return (
    <InspectorSection id="instance-props" title="Props e slots" defaultOpen>
      <div className={ui.grid2} data-testid="instance-props">
        {decls.map((p) => {
          const cur = instance.propValues?.[p.name];
          const write = (value: string | boolean) => set({ propValues: { ...instance.propValues, [p.name]: value } }, "prop da instância");
          if (p.type === "boolean") {
            return (
              <SelectField
                key={p.name}
                label={p.name}
                value={String(cur === true)}
                onChange={(v) => write(v === "true")}
                options={YES_NO}
              />
            );
          }
          if (p.type === "variant") {
            return (
              <SelectField
                key={p.name}
                label={p.name}
                value={typeof cur === "string" ? cur : String(p.default ?? p.options?.[0] ?? "")}
                onChange={(v) => write(v)}
                options={(p.options ?? []).map((o) => ({ value: o, label: o }))}
              />
            );
          }
          return <Field key={p.name} label={p.name} value={typeof cur === "string" ? cur : String(p.default ?? "")} onCommit={(v) => write(v)} />;
        })}
        {slots.map((slot) => (
          <Field
            key={slot.name}
            label={`Slot ${slot.name}`}
            value={(instance.slots?.[slot.name] ?? []).join(" ")}
            title="ids separados por espaço"
            onCommit={(v) => set({ slots: { ...instance.slots, [slot.name]: v.trim() ? v.trim().split(/[\s,]+/) : [] } }, "slot da instância")}
          />
        ))}
      </div>
      {keys.length > 0 && <p className={ui.muted}>overrides: {keys.join(", ")}</p>}
    </InspectorSection>
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
          <ConstraintsFields doc={props.doc} node={group} set={set} />
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
      <ComponentBind doc={props.doc} node={group} set={set} />
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
        <div className={ui.grid} data-testid="document-tokens">
          {[...new Map(Object.keys(doc.tokens).map((name) => [doc.tokenMeta?.[name]?.collection ?? "", name] as const)).keys()]
            .sort((a, b) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)))
            .map((collection) => (
              <div className="grid gap-1.5" key={collection || "base"}>
                {collection && <p className={cn(ui.muted, "m-0")}>{collection}</p>}
                {Object.entries(doc.tokens)
                  .filter(([k]) => (doc.tokenMeta?.[k]?.collection ?? "") === collection)
                  .map(([k, v]) => (
                    <div className="flex items-center gap-1.5 [&>div]:flex-1" key={k}>
                      {typeof v === "string" && /^#|^rgb/.test(v) && <span className="size-4 flex-none rounded-sm border border-ui-border" style={{ background: v }} />}
                      {doc.tokenMeta?.[k]?.type && (
                        <span className="rounded-sm bg-ui-muted px-1 text-2xs text-ui-foreground">{TOKEN_TYPE_LABEL[doc.tokenMeta[k].type!] ?? doc.tokenMeta[k].type}</span>
                      )}
                      <Field label={`$${k}`} value={v} onCommit={(nv) => apply([{ op: "set_tokens", tokens: { [k]: nv === "" ? null : tokenValue(nv) } }], "token")} />
                    </div>
                  ))}
              </div>
            ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const token = parseTokenAssignment(newToken);
              if (!token) return;
              apply(
                [
                  {
                    op: "set_tokens",
                    tokens: { [token.name]: tokenValue(token.value.trim()) },
                    ...(token.type ? { type: token.type as "color" } : {}),
                    ...(token.collection ? { collection: token.collection } : {}),
                  },
                ],
                "token",
              );
              setNewToken("");
            }}
          >
            <Input
              className="h-7 border-dashed"
              aria-label="Novo token"
              title="nome = valor, tipo nome = valor, ou coleção/tipo nome = valor"
              placeholder="nome = #e8553d"
              value={newToken}
              onChange={(e) => setNewToken(e.target.value)}
            />
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
