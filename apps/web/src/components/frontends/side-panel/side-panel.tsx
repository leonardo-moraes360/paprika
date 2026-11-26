import { Layers, SlidersHorizontal } from "lucide-react";
import { useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { PanelHandle } from "@/components/ui/panel-handle";
import { Tooltip } from "@/components/ui/tooltip";
import { readPersistedBoolean, readPersistedNumber, writePersisted, writePersistedBoolean } from "@/lib/persist";
import { cn } from "@/lib/utils";
import { ResizeSeparator } from "./resize-separator";
import { clampWidth, SidePanelRegion, type SidePanelState } from "./store";
import { sidePanelDefaults, type SidePanelProps } from "./types";

function limitsFor(props: SidePanelProps) {
  const defaults = sidePanelDefaults[props.side];
  const min = props.minWidth ?? defaults.min;
  const max = Math.max(min, props.maxWidth ?? defaults.max);
  const initial = clampWidth(props.initialWidth ?? defaults.initial, min, max);
  return { min, max, initial };
}

function initialState(props: SidePanelProps): SidePanelState {
  const { min, max, initial } = limitsFor(props);
  const key = props.storageKey;
  const stored = key ? readPersistedNumber(key) : null;
  const storedCollapsed = key ? readPersistedBoolean(`${key}.collapsed`) : null;
  return {
    width: stored === null ? initial : clampWidth(stored, min, max),
    collapsed: storedCollapsed ?? false,
    dragging: false,
  };
}

export function SidePanel(props: SidePanelProps) {
  return (
    <SidePanelRegion.Provider initial={() => initialState(props)}>
      <SidePanelView {...props} />
    </SidePanelRegion.Provider>
  );
}

function SidePanelView(props: SidePanelProps) {
  const { side, name, children, icon, step = 16, storageKey, onWidthChange, onCollapsedChange, className, panelClassName } = props;
  const { t } = useTranslation();
  const panelId = useId();
  const handle = useRef<HTMLButtonElement>(null);
  const store = SidePanelRegion.useRegionStore();
  const stateWidth = SidePanelRegion.useRegion((s) => s.width);
  const stateCollapsed = SidePanelRegion.useRegion((s) => s.collapsed);
  const dragging = SidePanelRegion.useRegion((s) => s.dragging);
  const { min, max, initial } = limitsFor(props);

  const widthControlled = props.width !== undefined;
  const collapsedControlled = props.collapsed !== undefined;
  const width = clampWidth(props.width ?? stateWidth, min, max);
  const collapsed = props.collapsed ?? stateCollapsed;

  const resize = (next: number) => {
    store.setState((s) => ({ ...s, width: next }));
    onWidthChange?.(next);
  };
  const commit = (next: number) => {
    if (storageKey && !widthControlled) writePersisted(storageKey, String(next));
  };
  const setCollapsed = (next: boolean) => {
    store.setState((s) => ({ ...s, collapsed: next }));
    if (storageKey && !collapsedControlled) writePersistedBoolean(`${storageKey}.collapsed`, next);
    onCollapsedChange?.(next);
  };
  const collapseFromSeparator = (restoreWidth: number) => {
    resize(clampWidth(restoreWidth, min, max));
    setCollapsed(true);
    queueMicrotask(() => handle.current?.focus());
  };

  const toggleLabel = t(collapsed ? "frontends.sidePanel.show" : "frontends.sidePanel.hide", { name });
  const handleSide = side === "left" ? "right" : "left";

  return (
    <div
      data-side={side}
      data-collapsed={collapsed ? "" : undefined}
      data-dragging={dragging ? "" : undefined}
      style={{ width: collapsed ? 0 : width }}
      className={cn(
        "relative flex h-full shrink-0 transition-[width] duration-160 ease-out motion-reduce:transition-none data-dragging:transition-none",
        className,
      )}
    >
      <aside
        id={panelId}
        aria-label={t("frontends.sidePanel.region", { name })}
        inert={collapsed}
        className="h-full min-w-0 flex-1 overflow-hidden bg-panel"
      >
        <div style={{ width }} className={cn("h-full", panelClassName)}>
          {children}
        </div>
      </aside>
      {collapsed ? null : (
        <ResizeSeparator
          side={side}
          label={t("frontends.sidePanel.resize", { name })}
          controls={panelId}
          value={width}
          min={min}
          max={max}
          initial={initial}
          step={step}
          dragging={dragging}
          onResize={resize}
          onCommit={commit}
          onDragChange={(next) => store.setState((s) => ({ ...s, dragging: next }))}
          onCollapse={collapseFromSeparator}
        />
      )}
      <div
        className={cn(
          "absolute top-1/2 z-10 -translate-y-1/2",
          side === "left" ? "left-full" : "right-full",
        )}
      >
        <Tooltip content={toggleLabel} side={handleSide} arrow>
          <PanelHandle
            ref={handle}
            side={side}
            aria-label={toggleLabel}
            expanded={!collapsed}
            controls={panelId}
            icon={icon ?? (side === "left" ? <Layers /> : <SlidersHorizontal />)}
            onClick={() => setCollapsed(!collapsed)}
          />
        </Tooltip>
      </div>
    </div>
  );
}
