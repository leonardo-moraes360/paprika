import { Plus, Trash2 } from "lucide-react";
import { listShadows, type Document, type ShadowSpec } from "@paprika/core";
import { Button } from "../components/ui/button";
import { ColorField, Field, SelectField, num } from "./fields";
import { InspectorSection } from "./InspectorSection";
import { cn } from "../lib/cn";

type EffectFilter = {
  blur?: number | string;
  saturate?: number;
  grayscale?: number;
  brightness?: number;
  sepia?: number;
  invert?: number;
  hueRotate?: number;
};

type Outline = {
  color: string;
  width: number | string;
  style?: "solid" | "dashed" | "dotted";
  offset?: number | string;
};

export type EffectNode = {
  shadow?: ShadowSpec | ShadowSpec[];
  outline?: Outline;
  filter?: EffectFilter;
  backdropFilter?: EffectFilter;
};

const STYLE_OPTS = [
  { value: "solid", label: "sólido" },
  { value: "dashed", label: "tracejado" },
  { value: "dotted", label: "pontilhado" },
] as const;

const FILTERS: { key: keyof EffectFilter; label: string; min: number; max: number }[] = [
  { key: "blur", label: "Blur", min: 0, max: 1000 },
  { key: "saturate", label: "Saturar", min: 0, max: 10 },
  { key: "grayscale", label: "Cinza", min: 0, max: 1 },
  { key: "brightness", label: "Brilho", min: 0, max: 10 },
  { key: "sepia", label: "Sépia", min: 0, max: 1 },
  { key: "invert", label: "Inverter", min: 0, max: 1 },
  { key: "hueRotate", label: "Matiz", min: -360, max: 360 },
];

const blankShadow = (): ShadowSpec => ({ x: 0, y: 4, blur: 12, spread: 0, color: "#00000040" });

export function EffectsSection({
  doc,
  node,
  mode,
  set,
}: {
  doc: Document;
  node: EffectNode;
  mode?: string;
  set(props: Record<string, unknown>): void;
}) {
  const shadows = listShadows(node.shadow);
  const writeShadows = (next: ShadowSpec[]) => {
    if (next.length === 0) set({ shadow: null });
    else if (next.length === 1) set({ shadow: next[0] });
    else set({ shadow: next });
  };
  const patchShadow = (i: number, patch: Partial<ShadowSpec>) => {
    const next = shadows.map((s, k) => (k === i ? { ...s, ...patch } : s));
    writeShadows(next);
  };
  const writeFilter = (key: "filter" | "backdropFilter", name: keyof EffectFilter, raw: string) => {
    const cur: EffectFilter = { ...(node[key] ?? {}) };
    if (!raw.trim()) delete cur[name];
    else {
      const n = num(raw);
      if (n === undefined) return;
      cur[name] = n;
    }
    set({ [key]: Object.keys(cur).length ? cur : null });
  };
  const outline = node.outline;
  return (
    <InspectorSection id="effects" title="Efeitos">
      <div className="grid gap-1" data-testid="shadow-list">
        {shadows.map((s, i) => (
          <div key={i} className="grid gap-1 rounded-md border border-ui-border p-1" data-testid={`shadow-${i}`}>
            <div className="grid grid-cols-2 gap-1">
              <Field label="X" type="number" value={s.x} onCommit={(v) => num(v) !== undefined && patchShadow(i, { x: num(v) })} />
              <Field label="Y" type="number" value={s.y} onCommit={(v) => num(v) !== undefined && patchShadow(i, { y: num(v) })} />
              <Field label="Blur" type="number" value={s.blur} min={0} onCommit={(v) => num(v) !== undefined && patchShadow(i, { blur: num(v) })} />
              <Field label="Exp" type="number" value={s.spread} onCommit={(v) => num(v) !== undefined && patchShadow(i, { spread: num(v) })} />
            </div>
            <div className="flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <ColorField doc={doc} mode={mode} label="Cor" value={s.color} onCommit={(v) => v && patchShadow(i, { color: v })} />
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                aria-pressed={!!s.inner}
                data-testid={`shadow-inner-${i}`}
                className={cn(s.inner && "border-ui-ring text-ui-ring")}
                onClick={() => {
                  const next = { ...s };
                  if (s.inner) delete next.inner;
                  else next.inner = true;
                  writeShadows(shadows.map((sh, k) => (k === i ? next : sh)));
                }}
              >
                interna
              </Button>
              <Button type="button" variant="ghost" size="icon" className="size-7" aria-label="Remover sombra" data-testid={`shadow-remove-${i}`} onClick={() => writeShadows(shadows.filter((_, k) => k !== i))}>
                <Trash2 aria-hidden />
              </Button>
            </div>
          </div>
        ))}
        <Button type="button" variant="secondary" size="sm" data-testid="shadow-add" onClick={() => writeShadows([...shadows, blankShadow()])}>
          <Plus aria-hidden />
          sombra
        </Button>
      </div>
      <div className="grid gap-1" data-testid="outline-fields">
        <ColorField
          doc={doc}
          mode={mode}
          label="Contorno"
          value={outline?.color}
          onCommit={(v) =>
            set({
              outline: v
                ? { color: v, width: outline?.width ?? 1, style: outline?.style ?? "solid", offset: outline?.offset ?? 0 }
                : null,
            })
          }
        />
        {outline && (
          <div className="grid grid-cols-2 gap-1">
            <Field label="Larg." type="number" value={outline.width} min={0} onCommit={(v) => num(v) !== undefined && set({ outline: { ...outline, width: num(v) } })} />
            <SelectField label="Tipo" value={outline.style ?? "solid"} testId="outline-style" onChange={(v) => set({ outline: { ...outline, style: v as Outline["style"] } })} options={STYLE_OPTS} />
            <Field label="Offset" type="number" value={outline.offset ?? 0} onCommit={(v) => num(v) !== undefined && set({ outline: { ...outline, offset: num(v) } })} />
          </div>
        )}
      </div>
      <FilterGrid title="Filtro" testId="filter" value={node.filter} onCommit={(name, raw) => writeFilter("filter", name, raw)} />
      <FilterGrid title="Filtro de fundo" testId="backdrop" value={node.backdropFilter} onCommit={(name, raw) => writeFilter("backdropFilter", name, raw)} />
    </InspectorSection>
  );
}

function FilterGrid({
  title,
  testId,
  value,
  onCommit,
}: {
  title: string;
  testId: string;
  value: EffectFilter | undefined;
  onCommit(name: keyof EffectFilter, raw: string): void;
}) {
  return (
    <div className="grid gap-1" data-testid={testId}>
      <p className="m-0 text-xs font-semibold text-ui-muted-foreground">{title}</p>
      <div className="grid grid-cols-2 gap-1">
        {FILTERS.map((f) => (
          <Field
            key={f.key}
            label={f.label}
            type="number"
            min={f.min}
            max={f.max}
            value={value?.[f.key]}
            onCommit={(v) => onCommit(f.key, v)}
          />
        ))}
      </div>
    </div>
  );
}
