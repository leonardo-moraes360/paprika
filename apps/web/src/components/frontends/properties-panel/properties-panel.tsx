import { copyOwner, isInstance, type FrameNode, type Node, type SceneNode } from "@paprika/core";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ScrollArea } from "@/components/ui/scroll-area";
import { readPersistedJson, writePersistedJson } from "@/lib/persist";
import { cn } from "@/lib/utils";
import { ConnectorPanel } from "./panels/connector-panel";
import { CopyPanel } from "./panels/copy-panel";
import { DocumentPanel } from "./panels/document-panel";
import { GroupPanel } from "./panels/group-panel";
import { InstancePanel } from "./panels/instance-panel";
import { MultiPanel } from "./panels/multi-panel";
import { NodePanel } from "./panels/node-panel";
import { PagePanel } from "./panels/page-panel";
import { initialPropertiesPanelState, isOpenMap, PropertiesPanelRegion } from "./store";
import type { PropertiesPanelProps, SetProps } from "./types";

export function PropertiesPanel(props: PropertiesPanelProps) {
  return (
    <PropertiesPanelRegion.Provider
      store={props.store}
      initial={() => initialPropertiesPanelState(props.storageKey === undefined ? {} : (readPersistedJson(props.storageKey, isOpenMap) ?? {}))}
    >
      <PropertiesPanelView {...props} />
    </PropertiesPanelRegion.Provider>
  );
}

function PropertiesPanelView({
  doc,
  node,
  selected,
  lint,
  activity = [],
  activityMarker,
  header,
  renderFontPicker,
  onApply,
  onSelect,
  onError,
  storageKey,
  className,
}: PropertiesPanelProps) {
  const { t } = useTranslation();
  const store = PropertiesPanelRegion.useRegionStore();

  useEffect(() => {
    if (storageKey === undefined) return;
    const subscription = store.subscribe((state) => writePersistedJson(storageKey, state.open));
    return () => subscription.unsubscribe();
  }, [store, storageKey]);

  const base = { onApply, onSelect, onError, renderFontPicker };
  const setFor =
    (target: Node): SetProps =>
    (props, label) =>
      onApply([{ op: "update", id: target.id, props }], label ?? t("frontends.propertiesPanel.ops.editProperty"));

  let body;
  if (!doc) {
    body = <p className="px-3.5 py-3.5 text-sm text-muted">{t("frontends.propertiesPanel.nothingSelected")}</p>;
  } else if (selected.length > 1) {
    body = <MultiPanel doc={doc} ids={selected} onApply={onApply} onSelect={onSelect} onError={onError} />;
  } else if (!node) {
    body = <DocumentPanel doc={doc} lint={lint} activity={activity} activityMarker={activityMarker} onApply={onApply} onSelect={onSelect} />;
  } else if (node.type === "page") {
    body = <PagePanel {...base} doc={doc} node={node} set={setFor(node)} />;
  } else if (copyOwner(doc, node as SceneNode)) {
    body = <CopyPanel {...base} doc={doc} node={node as SceneNode} instance={copyOwner(doc, node as SceneNode) as FrameNode} set={setFor(node)} />;
  } else if (node.type === "group") {
    body = <GroupPanel {...base} doc={doc} node={node} set={setFor(node)} />;
  } else if (node.type === "connector") {
    body = <ConnectorPanel {...base} doc={doc} node={node} set={setFor(node)} />;
  } else if (isInstance(node)) {
    body = <InstancePanel {...base} doc={doc} node={node} set={setFor(node)} />;
  } else {
    body = <NodePanel {...base} doc={doc} node={node} set={setFor(node)} />;
  }

  return (
    <aside aria-label={t("frontends.propertiesPanel.region")} data-properties-panel="" tabIndex={-1} className={cn("flex h-full outline-none min-h-0 w-full flex-col bg-tile text-fg", className)}>
      {header ? <div className="shrink-0">{header}</div> : null}
      <ScrollArea className="min-h-0 flex-1" viewportClassName="pb-2">
        {body}
      </ScrollArea>
    </aside>
  );
}
