import { nodeGradient, type Document, type Gradient, type Node } from "@paprika/core";
import { Plus, X } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { SegmentedControl, SegmentedControlItem } from "@/components/ui/segmented-control";
import { ColorValueField } from "../fields/color-value-field";
import { NumericField } from "../fields/numeric-field";
import type { SetProps } from "../types";

export type GradientFieldsProps = {
  doc: Document;
  node: Node;
  mode?: string;
  fill: string | undefined;
  set: SetProps;
};

const KINDS = ["solid", "linear", "radial", "conic"] as const;
const MAX_STOPS = 12;

function fresh(type: Gradient["type"], fill: string | undefined): Gradient {
  const first = fill && !/gradient\(|url\(/i.test(fill) ? fill : "rgb(200, 64, 31)";
  return {
    type,
    angle: type === "conic" ? 0 : 90,
    cx: 0.5,
    cy: 0.5,
    radius: 0.5,
    stops: [
      { color: first, offset: 0 },
      { color: "rgb(76, 199, 216)", offset: 1 },
    ],
  };
}

export function GradientKindControl({ node, fill, set }: Pick<GradientFieldsProps, "node" | "fill" | "set">) {
  const { t } = useTranslation();
  const gradient = nodeGradient(node);
  const current = gradient ? gradient.type : "solid";
  return (
    <SegmentedControl
      aria-label={t("frontends.propertiesPanel.fill.kind")}
      stretch
      value={current}
      onValueChange={(next) => {
        if (next === null || next === current) return;
        const label = t("frontends.propertiesPanel.ops.fill");
        if (next === "solid") set({ gradient: null }, label);
        else set({ gradient: gradient ? { ...gradient, type: next as Gradient["type"] } : fresh(next as Gradient["type"], fill) }, label);
      }}
    >
      {KINDS.map((kind) => (
        <SegmentedControlItem key={kind} value={kind}>
          {t(`frontends.propertiesPanel.fill.kinds.${kind}`)}
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  );
}

export function GradientEditor({ doc, node, mode, set }: Omit<GradientFieldsProps, "fill">) {
  const { t } = useTranslation();
  const gradient = nodeGradient(node);
  if (!gradient) return null;
  const label = t("frontends.propertiesPanel.ops.gradient");
  const write = (next: Gradient) => set({ gradient: next }, label);
  const addButton = useRef<HTMLButtonElement>(null);
  return (
    <div className="flex flex-col gap-2">
      {gradient.type !== "radial" ? (
        <NumericField label={t("frontends.propertiesPanel.fill.angle")} prefix="∠" unit="°" value={gradient.angle} onCommit={(angle) => write({ ...gradient, angle: Number(angle) })} />
      ) : null}
      <p className="text-xs font-semibold text-label">{t("frontends.propertiesPanel.fill.stops")}</p>
      <ul className="flex flex-col gap-2">
        {gradient.stops.map((stop, index) => (
          <li key={index} className="grid grid-cols-[1fr_5.5rem_auto] items-start gap-1.5">
            <ColorValueField
              doc={doc}
              mode={mode}
              label={t("frontends.propertiesPanel.fill.stop", { index: index + 1 })}
              value={stop.color}
              clearable={false}
              onCommit={(color) => color && write({ ...gradient, stops: gradient.stops.map((s, i) => (i === index ? { ...s, color } : s)) })}
            />
            <NumericField
              label={t("frontends.propertiesPanel.fill.stopOffset", { index: index + 1 })}
              unit="%"
              min={0}
              max={100}
              value={Math.round(stop.offset * 1000) / 10}
              onCommit={(percent) => write({ ...gradient, stops: gradient.stops.map((s, i) => (i === index ? { ...s, offset: Number(percent) / 100 } : s)) })}
            />
            <IconButton
              bordered
              className="size-9"
              aria-label={t("frontends.propertiesPanel.fill.removeStop", { index: index + 1 })}
              disabled={gradient.stops.length <= 2}
              onClick={() => {
                addButton.current?.focus();
                write({ ...gradient, stops: gradient.stops.filter((_, i) => i !== index) });
              }}
            >
              <X aria-hidden="true" />
            </IconButton>
          </li>
        ))}
      </ul>
      {gradient.stops.length < MAX_STOPS ? (
        <Button
          ref={addButton}
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            const last = gradient.stops[gradient.stops.length - 1];
            const previous = gradient.stops[gradient.stops.length - 2];
            if (!last || !previous) return;
            const offset = Math.round(((previous.offset + last.offset) / 2) * 1000) / 1000;
            write({ ...gradient, stops: [...gradient.stops.slice(0, -1), { color: last.color, offset }, last] });
          }}
        >
          <Plus aria-hidden="true" />
          {t("frontends.propertiesPanel.fill.addStop")}
        </Button>
      ) : null}
    </div>
  );
}
