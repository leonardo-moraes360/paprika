import type { Node } from "@paprika/core";
import { useTranslation } from "react-i18next";
import { IdentityHeader } from "../identity-header";
import { AppearanceSection } from "../sections/appearance-section";
import { ArrangeSection } from "../sections/arrange-section";
import { BindSection } from "../sections/bind-section";
import { ComponentSection } from "../sections/component-section";
import { ConstraintsSection } from "../sections/constraints-section";
import { ContentSection } from "../sections/content-section";
import { EffectsSection } from "../sections/effects-section";
import { LayoutSection } from "../sections/layout-section";
import { NotesSection } from "../sections/notes-section";
import { ImageSection } from "../sections/image-section";
import { PositionSection } from "../sections/position-section";
import { ShapeSection } from "../sections/shape-section";
import { ThemeModeSection } from "../sections/theme-mode-section";
import { TokenUsesSection } from "../sections/token-uses-section";
import { TypographySection } from "../sections/typography-section";
import { VectorSection } from "../sections/vector-section";
import { WebSection } from "../sections/web-section";
import type { NodePanelBase } from "./shared";

type Plain = Exclude<Node, { type: "page" | "group" | "connector" }>;

export function NodePanel({ doc, node, set, onApply, onSelect, renderFontPicker }: NodePanelBase<Plain>) {
  const { t } = useTranslation();
  return (
    <div key={node.id} data-testid="node-panel">
      <IdentityHeader kind={node.type} id={node.id} name={node.name} onRename={(name) => set({ name }, t("frontends.propertiesPanel.ops.rename"))} />
      <PositionSection doc={doc} node={node} set={set} />
      <ConstraintsSection doc={doc} node={node} set={set} />
      <ContentSection doc={doc} node={node} onApply={onApply} />
      <AppearanceSection doc={doc} node={node} set={set} />
      {node.type === "text" || node.type === "shape" ? <TypographySection doc={doc} node={node} set={set} renderFontPicker={renderFontPicker} /> : null}
      {node.type === "shape" ? <ShapeSection node={node} set={set} /> : null}
      {node.type === "image" ? <ImageSection node={node} set={set} /> : null}
      {node.type === "path" ? <VectorSection node={node} set={set} /> : null}
      <EffectsSection doc={doc} node={node} set={set} />
      {node.type === "frame" ? (
        <>
          <LayoutSection node={node} set={set} />
          <ComponentSection node={node} set={set} onApply={onApply} onSelect={onSelect} />
          <WebSection doc={doc} node={node} set={set} />
          <ThemeModeSection doc={doc} node={node} set={set} />
        </>
      ) : null}
      <TokenUsesSection node={node} onApply={onApply} />
      <BindSection doc={doc} node={node} set={set} />
      <ArrangeSection ids={[node.id]} onApply={onApply} />
      <NotesSection notes={node.notes} set={set} />
    </div>
  );
}
