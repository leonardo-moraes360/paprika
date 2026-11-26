import { X } from "lucide-react";
import type { Document, Gradient, Node } from "@paprika/core";
import { nodeGradient } from "@paprika/core";
import { Button } from "../components/ui/button";
import { useT } from "../i18n";
import { cn } from "../lib/cn";
import { ColorField, Field } from "./fields";

type Paintable = Exclude<Node, { type: "group" | "connector" }>;

function fresh(type: Gradient["type"], fill: string | undefined): Gradient {
  const first = fill && !/gradient\(|url\(/i.test(fill) ? fill : "#c8401f";
  return {
    type,
    angle: type === "conic" ? 0 : 90,
    cx: 0.5,
    cy: 0.5,
    radius: 0.5,
    stops: [
      { color: first, offset: 0 },
      { color: "#4cc7d8", offset: 1 },
    ],
  };
}

export function GradientField({
  doc,
  node,
  mode,
  onChange,
}: {
  doc: Document;
  node: Paintable;
  mode?: string;
  onChange(props: Record<string, unknown>): void;
}) {
  const m = useT();
  const gradient = nodeGradient(node);
  const kinds = [
    { id: "solid" as const, label: m.fillSolid },
    { id: "linear" as const, label: m.fillLinear },
    { id: "radial" as const, label: m.fillRadial },
    { id: "conic" as const, label: m.fillConic },
  ];
  const pick = (id: (typeof kinds)[number]["id"]) => {
    if (id === "solid") {
      onChange({ gradient: null });
      return;
    }
    onChange({ gradient: gradient ? { ...gradient, type: id } : fresh(id, node.fill) });
  };
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-1" data-testid="gradient-kinds">
        {kinds.map((k) => {
          const on = k.id === "solid" ? !gradient : gradient?.type === k.id;
          return (
            <Button key={k.id} type="button" size="sm" variant={on ? "default" : "secondary"} aria-pressed={on} onClick={() => pick(k.id)}>
              {k.label}
            </Button>
          );
        })}
      </div>
      {gradient && (
        <div className="grid gap-2" data-testid="gradient-editor">
          {gradient.type !== "radial" && (
            <Field
              label={m.gradientAngle}
              type="number"
              value={gradient.angle}
              onCommit={(v) => {
                const n = Number(v);
                if (Number.isFinite(n)) onChange({ gradient: { ...gradient, angle: n } });
              }}
            />
          )}
          <p className="m-0 text-2xs font-semibold text-muted">{m.gradientStops}</p>
          {gradient.stops.map((stop, index) => (
            <div key={index} className="grid grid-cols-[1fr_72px_auto] items-center gap-1.5">
              <ColorField
                doc={doc}
                mode={mode}
                label={`${m.gradientStops} ${index + 1}`}
                value={stop.color}
                onCommit={(color) => {
                  if (!color) return;
                  const stops = gradient.stops.map((s, i) => (i === index ? { ...s, color } : s));
                  onChange({ gradient: { ...gradient, stops } });
                }}
              />
              <Field
                label="%"
                type="number"
                value={Math.round(stop.offset * 1000) / 10}
                onCommit={(v) => {
                  const n = Number(v);
                  if (!Number.isFinite(n)) return;
                  const stops = gradient.stops.map((s, i) => (i === index ? { ...s, offset: Math.min(1, Math.max(0, n / 100)) } : s));
                  onChange({ gradient: { ...gradient, stops } });
                }}
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={gradient.stops.length <= 2}
                aria-label={m.gradientRemoveStop}
                onClick={() => onChange({ gradient: { ...gradient, stops: gradient.stops.filter((_, i) => i !== index) } })}
              >
                <X className="size-3" aria-hidden />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className={cn(gradient.stops.length >= 12 && "hidden")}
            onClick={() => {
              const last = gradient.stops[gradient.stops.length - 1]!;
              const prev = gradient.stops[gradient.stops.length - 2]!;
              const offset = Math.round(((prev.offset + last.offset) / 2) * 1000) / 1000;
              onChange({
                gradient: {
                  ...gradient,
                  stops: [...gradient.stops.slice(0, -1), { color: last.color, offset }, last],
                },
              });
            }}
          >
            {m.gradientAddStop}
          </Button>
        </div>
      )}
    </div>
  );
}
