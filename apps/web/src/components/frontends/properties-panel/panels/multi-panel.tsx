import {
  alignOps,
  distributeOps,
  groupOps,
  newId,
  ungroupOps,
  wrapOps,
  type AlignEdge,
  type Document,
  type Op,
} from "@paprika/core";
import {
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignHorizontalSpaceBetween,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalSpaceBetween,
  Frame,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { errorMessageOr } from "@/lib/use-async-action";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { PanelSection } from "../panel-section";
import { ArrangeSection } from "../sections/arrange-section";
import type { ApplyResult, PropertiesPanelShortcuts } from "../types";

export type MultiPanelProps = {
  doc: Document;
  ids: readonly string[];
  onApply: (ops: Op[], label: string) => ApplyResult;
  onSelect: (ids: string[]) => void;
  onError?: (message: string) => void;
  shortcuts?: PropertiesPanelShortcuts;
};

const isThenable = (value: unknown): value is PromiseLike<unknown> => typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";
const hint = (keys?: readonly string[]) => (keys?.length ? keys.join("+") : undefined);

const EDGES: { edge: AlignEdge; icon: ReactNode }[] = [
  { edge: "left", icon: <AlignHorizontalJustifyStart aria-hidden="true" /> },
  { edge: "center", icon: <AlignHorizontalJustifyCenter aria-hidden="true" /> },
  { edge: "right", icon: <AlignHorizontalJustifyEnd aria-hidden="true" /> },
  { edge: "top", icon: <AlignVerticalJustifyStart aria-hidden="true" /> },
  { edge: "middle", icon: <AlignVerticalJustifyCenter aria-hidden="true" /> },
  { edge: "bottom", icon: <AlignVerticalJustifyEnd aria-hidden="true" /> },
];

export function MultiPanel({ doc, ids, shortcuts, onApply, onSelect, onError }: MultiPanelProps) {
  const { t } = useTranslation();
  const attempt = (action: () => void) => {
    try {
      action();
    } catch (error) {
      onError?.(errorMessageOr(error, t("frontends.propertiesPanel.unknownError")));
    }
  };
  const groups = ids.filter((id) => doc.nodes[id]?.type === "group");
  const ids_ = [...ids];

  // Selecting what an operation created only makes sense once the owner has accepted it.
  const applyThenSelect = (ops: Op[], label: string, next: () => string[]) => {
    const select = () => onSelect(next());
    const result = onApply(ops, label);
    if (isThenable(result)) result.then(select, (error: unknown) => onError?.(errorMessageOr(error, t("frontends.propertiesPanel.unknownError"))));
    else select();
  };

  const group = () =>
    attempt(() => {
      groupOps(doc, ids_);
      const id = newId();
      applyThenSelect([{ op: "group", ids: ids_, id }], t("frontends.propertiesPanel.ops.group"), () => [id]);
    });
  const ungroup = () =>
    attempt(() => {
      const { released } = ungroupOps(doc, groups);
      applyThenSelect([{ op: "ungroup", ids: groups }], t("frontends.propertiesPanel.ops.ungroup"), () => released);
    });
  const wrap = () =>
    attempt(() => {
      const id = newId();
      wrapOps(doc, ids_);
      applyThenSelect([{ op: "wrap", ids: ids_, id }], t("frontends.propertiesPanel.ops.wrap"), () => [id]);
    });
  const align = (edge: AlignEdge) =>
    attempt(() => {
      if (alignOps(doc, ids_, edge).ops.length) onApply([{ op: "align", ids: ids_, edge }], t(`frontends.propertiesPanel.align.${edge}`));
    });
  const distribute = (axis: "horizontal" | "vertical") =>
    attempt(() => {
      if (distributeOps(doc, ids_, axis).ops.length) onApply([{ op: "distribute", ids: ids_, axis }], t(`frontends.propertiesPanel.align.distribute.${axis}`));
    });

  return (
    <div data-testid="multi-panel">
      <div className="flex flex-col gap-2 px-3.5 pt-1 pb-3.5">
        <h2 className="text-sm font-semibold text-fg">{t("frontends.propertiesPanel.multi.selected", { count: ids.length })}</h2>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" title={hint(shortcuts?.group)} onClick={group}>
            {t("frontends.propertiesPanel.multi.group")}
          </Button>
          {groups.length > 0 ? (
            <Button type="button" variant="secondary" size="sm" title={hint(shortcuts?.ungroup)} onClick={ungroup}>
              {t("frontends.propertiesPanel.multi.ungroup")}
            </Button>
          ) : null}
          <Button type="button" size="sm" title={hint(shortcuts?.wrap)} onClick={wrap}>
            <Frame aria-hidden="true" />
            {t("frontends.propertiesPanel.multi.wrap")}
          </Button>
        </div>
      </div>
      <PanelSection id="align" title={t("frontends.propertiesPanel.align.title")} defaultOpen>
        <div className="flex flex-wrap gap-1.5">
          {EDGES.map(({ edge, icon }) => (
            <IconButton key={edge} size="sm" bordered aria-label={t(`frontends.propertiesPanel.align.${edge}`)} title={t(`frontends.propertiesPanel.align.${edge}`)} onClick={() => align(edge)}>
              {icon}
            </IconButton>
          ))}
          <IconButton size="sm" bordered disabled={ids.length < 3} aria-label={t("frontends.propertiesPanel.align.distribute.horizontal")} title={t("frontends.propertiesPanel.align.distribute.horizontal")} onClick={() => distribute("horizontal")}>
            <AlignHorizontalSpaceBetween aria-hidden="true" />
          </IconButton>
          <IconButton size="sm" bordered disabled={ids.length < 3} aria-label={t("frontends.propertiesPanel.align.distribute.vertical")} title={t("frontends.propertiesPanel.align.distribute.vertical")} onClick={() => distribute("vertical")}>
            <AlignVerticalSpaceBetween aria-hidden="true" />
          </IconButton>
        </div>
      </PanelSection>
      <ArrangeSection ids={ids} onApply={onApply} defaultOpen />
      <p className="border-t border-line px-3.5 py-3.5 text-xs text-muted">{t("frontends.propertiesPanel.multi.hint")}</p>
    </div>
  );
}
