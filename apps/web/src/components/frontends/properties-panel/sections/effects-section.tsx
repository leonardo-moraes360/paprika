import { listShadows, modeOf, type Document, type Node, type ShadowSpec } from "@paprika/core";
import { Plus, Trash2 } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { IconToggle } from "@/components/ui/icon-toggle";
import { PropertyRow } from "@/components/ui/property-row";
import { ChoiceField } from "../fields/choice-field";
import { ColorValueField } from "../fields/color-value-field";
import { NumericField } from "../fields/numeric-field";
import { PanelSection } from "../panel-section";
import type { SetProps } from "../types";

type Filter = Partial<Record<"blur" | "saturate" | "grayscale" | "brightness" | "sepia" | "invert" | "hueRotate", number | string>>;
type Outline = { color: string; width: number | string; style?: string; offset?: number | string };
type EffectNode = { shadow?: ShadowSpec | ShadowSpec[]; outline?: Outline; filter?: Filter; backdropFilter?: Filter };

export type EffectsSectionProps = {
  doc: Document;
  node: Exclude<Node, { type: "page" | "group" | "connector" }>;
  set: SetProps;
};

const FILTERS = [
  { key: "blur", min: 0, max: 1000 },
  { key: "saturate", min: 0, max: 10 },
  { key: "grayscale", min: 0, max: 1 },
  { key: "brightness", min: 0, max: 10 },
  { key: "sepia", min: 0, max: 1 },
  { key: "invert", min: 0, max: 1 },
  { key: "hueRotate", min: -360, max: 360 },
] as const;

const blankShadow = (): ShadowSpec => ({ x: 0, y: 4, blur: 12, spread: 0, color: "rgba(0, 0, 0, 0.25)" });

export function EffectsSection({ doc, node, set }: EffectsSectionProps) {
  const { t } = useTranslation();
  const mode = modeOf(doc, node);
  const effects = node as unknown as EffectNode;
  const shadows = listShadows(effects.shadow);
  const label = t("frontends.propertiesPanel.ops.effects");
  const addButton = useRef<HTMLButtonElement>(null);

  const writeShadows = (next: ShadowSpec[]) => set({ shadow: next.length === 0 ? null : next.length === 1 ? next[0] : next }, label);
  const patchShadow = (index: number, patch: Partial<ShadowSpec>) => writeShadows(shadows.map((shadow, i) => (i === index ? { ...shadow, ...patch } : shadow)));
  const outline = effects.outline;
  const writeFilter = (key: "filter" | "backdropFilter", name: keyof Filter, value: number | null) => {
    const next: Filter = { ...(effects[key] ?? {}) };
    if (value === null) delete next[name];
    else next[name] = value;
    set({ [key]: Object.keys(next).length ? next : null }, label);
  };

  const filterGrid = (key: "filter" | "backdropFilter", title: string) => (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-semibold text-label">{title}</p>
      <PropertyRow title={title} hideTitle>
        {FILTERS.map((item) => (
          <NumericField
            key={item.key}
            label={`${title}: ${t(`frontends.propertiesPanel.effects.filters.${item.key}`)}`}
            prefix={t(`frontends.propertiesPanel.effects.filterPrefix.${item.key}`)}
            min={item.min}
            max={item.max}
            value={effects[key]?.[item.key]}
            onCommit={(value) => writeFilter(key, item.key, Number(value))}
            onClear={() => writeFilter(key, item.key, null)}
          />
        ))}
      </PropertyRow>
    </div>
  );

  return (
    <PanelSection id="effects" title={t("frontends.propertiesPanel.effects.title")} defaultOpen={shadows.length > 0 || !!outline}>
      <ul className="flex flex-col gap-2">
        {shadows.map((shadow, index) => (
          <li key={index} role="group" aria-label={t("frontends.propertiesPanel.effects.shadowN", { index: index + 1 })} className="flex flex-col gap-2 rounded-md border border-line p-2">
            <PropertyRow title={t("frontends.propertiesPanel.effects.shadow")} hideTitle>
              <NumericField label={t("frontends.propertiesPanel.effects.shadowX")} prefix="X" value={shadow.x} onCommit={(x) => patchShadow(index, { x: x as number })} />
              <NumericField label={t("frontends.propertiesPanel.effects.shadowY")} prefix="Y" value={shadow.y} onCommit={(y) => patchShadow(index, { y: y as number })} />
              <NumericField label={t("frontends.propertiesPanel.effects.shadowBlur")} prefix="B" min={0} value={shadow.blur} onCommit={(blur) => patchShadow(index, { blur: blur as number })} />
              <NumericField label={t("frontends.propertiesPanel.effects.shadowSpread")} prefix="S" value={shadow.spread} onCommit={(spread) => patchShadow(index, { spread: spread as number })} />
            </PropertyRow>
            <ColorValueField
              doc={doc}
              mode={mode}
              label={t("frontends.propertiesPanel.effects.shadowColor")}
              value={shadow.color}
              clearable={false}
              onCommit={(color) => color && patchShadow(index, { color })}
            />
            <div className="flex items-center justify-between gap-2">
              <IconToggle
                bordered
                pressed={!!shadow.inner}
                onPressedChange={(inner) => {
                  const next = { ...shadow };
                  if (inner) next.inner = true;
                  else delete next.inner;
                  writeShadows(shadows.map((item, i) => (i === index ? next : item)));
                }}
                aria-label={t("frontends.propertiesPanel.effects.inner")}
                className="w-auto px-2 text-xs font-semibold"
              >
                {t("frontends.propertiesPanel.effects.inner")}
              </IconToggle>
              <IconButton size="sm" aria-label={t("frontends.propertiesPanel.effects.removeShadow", { index: index + 1 })} onClick={() => {
                  addButton.current?.focus();
                  writeShadows(shadows.filter((_, i) => i !== index));
                }}
              >
                <Trash2 aria-hidden="true" />
              </IconButton>
            </div>
          </li>
        ))}
      </ul>
      <Button ref={addButton} type="button" variant="secondary" size="sm" onClick={() => writeShadows([...shadows, blankShadow()])}>
        <Plus aria-hidden="true" />
        {t("frontends.propertiesPanel.effects.addShadow")}
      </Button>
      <ColorValueField
        doc={doc}
        mode={mode}
        label={t("frontends.propertiesPanel.effects.outline")}
        value={outline?.color}
        onCommit={(color) => set({ outline: color ? { color, width: outline?.width ?? 1, style: outline?.style ?? "solid", offset: outline?.offset ?? 0 } : null }, label)}
      />
      {outline ? (
        <PropertyRow title={t("frontends.propertiesPanel.effects.outline")} hideTitle>
          <NumericField label={t("frontends.propertiesPanel.effects.outlineWidth")} prefix="W" min={0} value={outline.width} onCommit={(width) => set({ outline: { ...outline, width } }, label)} />
          <NumericField label={t("frontends.propertiesPanel.effects.outlineOffset")} prefix="O" value={outline.offset ?? 0} onCommit={(offset) => set({ outline: { ...outline, offset } }, label)} />
          <ChoiceField
            label={t("frontends.propertiesPanel.effects.outlineStyle")}
            value={outline.style ?? "solid"}
            options={(["solid", "dashed", "dotted"] as const).map((style) => ({ value: style, label: t(`frontends.propertiesPanel.border.style.${style}`) }))}
            onValueChange={(style) => set({ outline: { ...outline, style } }, label)}
          />
        </PropertyRow>
      ) : null}
      {filterGrid("filter", t("frontends.propertiesPanel.effects.filter"))}
      {filterGrid("backdropFilter", t("frontends.propertiesPanel.effects.backdrop"))}
    </PanelSection>
  );
}
