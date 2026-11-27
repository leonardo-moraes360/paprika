import { Layers, Settings2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { PanelHandle } from "@/components/ui/panel-handle";
import {
  createResizableController,
  Resizable,
  ResizableHandle,
  ResizablePanel,
  type ResizableLayoutChangeDetails,
  type ResizableLayoutCommitDetails,
} from "@/components/ui/resizable";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { persistedLayoutStorage } from "./storage";
import {
  editorLayoutDefaults,
  type EditorLayoutPanelLabels,
  type EditorLayoutPanelSize,
  type EditorLayoutProps,
  type EditorLayoutSide,
  type EditorLayoutValue,
} from "./types";

const sides = ["left", "right"] as const;
const panelIndex = { left: 0, right: 2 } as const;

const clamp = (value: number, size: EditorLayoutPanelSize) => Math.round(Math.min(size.max, Math.max(size.min, value)));

export function EditorLayout({
  left,
  center,
  right,
  id = "editor-layout",
  leftSize = editorLayoutDefaults.left,
  rightSize = editorLayoutDefaults.right,
  centerMinWidth = editorLayoutDefaults.centerMin,
  value,
  defaultValue,
  onValueChange,
  onValueCommit,
  storageKey,
  labels,
  className,
}: EditorLayoutProps) {
  const { t } = useTranslation();
  const [controller] = useState(createResizableController);
  const root = useRef<HTMLDivElement>(null);
  const panels = { left: useRef<HTMLDivElement>(null), center: useRef<HTMLDivElement>(null), right: useRef<HTMLDivElement>(null) };
  const handles = { left: useRef<HTMLButtonElement>(null), right: useRef<HTMLButtonElement>(null) };
  const ids = { left: `${id}-left`, center: `${id}-center`, right: `${id}-right` };
  const limits = { left: leftSize, right: rightSize };
  const [collapsed, setCollapsed] = useState({ left: false, right: false });
  const collapsedRef = useRef(collapsed);
  const focusHandle = useRef<EditorLayoutSide | null>(null);
  const [rtl, setRtl] = useState(false);
  const [syncTick, setSyncTick] = useState(0);
  const lastOpen = useRef({
    left: clamp(value?.left ?? defaultValue?.left ?? leftSize.initial, leftSize),
    right: clamp(value?.right ?? defaultValue?.right ?? rightSize.initial, rightSize),
  });

  const text: Record<EditorLayoutSide, EditorLayoutPanelLabels> = {
    left: {
      region: labels?.left?.region ?? t("frontends.editorLayout.left.region"),
      resize: labels?.left?.resize ?? t("frontends.editorLayout.left.resize"),
      show: labels?.left?.show ?? t("frontends.editorLayout.left.show"),
      hide: labels?.left?.hide ?? t("frontends.editorLayout.left.hide"),
    },
    right: {
      region: labels?.right?.region ?? t("frontends.editorLayout.right.region"),
      resize: labels?.right?.resize ?? t("frontends.editorLayout.right.resize"),
      show: labels?.right?.show ?? t("frontends.editorLayout.right.show"),
      hide: labels?.right?.hide ?? t("frontends.editorLayout.right.hide"),
    },
  };

  const reportCollapsed = (side: EditorLayoutSide, next: boolean) => {
    if (collapsedRef.current[side] === next) return;
    collapsedRef.current = { ...collapsedRef.current, [side]: next };
    setCollapsed(collapsedRef.current);
  };

  const keepFocus = (side: EditorLayoutSide) => {
    if (panels[side].current?.contains(document.activeElement)) focusHandle.current = side;
  };

  const watchCollapse = () => {
    for (const side of sides) {
      if (controller.isCollapsed(ids[side]) && !collapsedRef.current[side]) keepFocus(side);
    }
  };

  const groupWidth = () => [panels.left, panels.center, panels.right].reduce((sum, panel) => sum + (panel.current?.getBoundingClientRect().width ?? 0), 0);

  const measure = (layout: number[]): EditorLayoutValue => {
    const total = groupWidth();
    const leftCollapsed = controller.isCollapsed(ids.left);
    const rightCollapsed = controller.isCollapsed(ids.right);
    if (!leftCollapsed) lastOpen.current.left = clamp(((layout[panelIndex.left] ?? 0) / 100) * total, leftSize);
    if (!rightCollapsed) lastOpen.current.right = clamp(((layout[panelIndex.right] ?? 0) / 100) * total, rightSize);
    return { ...lastOpen.current, leftCollapsed, rightCollapsed };
  };

  const onLayoutChange = (layout: number[], details: ResizableLayoutChangeDetails) => {
    watchCollapse();
    if (onValueChange && details.reason !== "imperative") onValueChange(measure(layout));
  };

  const onLayoutCommit = (layout: number[], details: ResizableLayoutCommitDetails) => {
    watchCollapse();
    if (details.reason === "imperative") return;
    onValueCommit?.(measure(layout));
    if (value) setSyncTick((tick) => tick + 1);
  };

  const toggle = (side: EditorLayoutSide) => {
    const hide = !collapsedRef.current[side];
    if (value) {
      const next = { ...value, [side === "left" ? "leftCollapsed" : "rightCollapsed"]: hide };
      onValueChange?.(next);
      onValueCommit?.(next);
      return;
    }
    if (hide) {
      keepFocus(side);
      controller.collapse(ids[side]);
    } else {
      controller.expand(ids[side]);
    }
  };

  useEffect(() => {
    setRtl((root.current?.closest("[dir]")?.getAttribute("dir") ?? "ltr") === "rtl");
  }, []);

  useEffect(() => {
    const side = focusHandle.current;
    if (!side || !collapsed[side]) return;
    focusHandle.current = null;
    handles[side].current?.focus();
  }, [collapsed]);

  useEffect(() => {
    if (!value) return;
    const total = groupWidth();
    const wanted = { left: [value.left, value.leftCollapsed], right: [value.right, value.rightCollapsed] } as const;
    for (const side of sides) {
      const [px, hide] = wanted[side];
      if (controller.isCollapsed(ids[side]) !== hide) {
        if (hide) {
          keepFocus(side);
          controller.collapse(ids[side]);
        } else {
          controller.expand(ids[side]);
        }
      }
      if (hide) continue;
      const target = clamp(px, limits[side]);
      const current = ((controller.getLayout()[panelIndex[side]] ?? 0) / 100) * total;
      if (Math.abs(current - target) > 0.5) controller.resize(ids[side], `${target}px`);
    }
  }, [value?.left, value?.right, value?.leftCollapsed, value?.rightCollapsed, syncTick]);

  const initialSize = (side: EditorLayoutSide) => `${clamp(defaultValue?.[side] ?? limits[side].initial, limits[side])}px` as const;

  return (
    <div ref={root} className={cn("relative size-full min-w-0", className)}>
      <Resizable
        controller={controller}
        autoSaveId={value ? undefined : storageKey}
        storage={persistedLayoutStorage}
        step={1}
        largeStep={5}
        onLayoutChange={onLayoutChange}
        onLayoutCommit={onLayoutCommit}
      >
        <EdgePanel side="left" id={ids.left} panelRef={panels.left} size={leftSize} initialSize={initialSize("left")} label={text.left.region} onCollapsed={reportCollapsed}>
          {left}
        </EdgePanel>
        <HandleSlot
          side="left"
          rtl={rtl}
          labels={text.left}
          collapsed={collapsed.left}
          controls={ids.left}
          icon={<Layers />}
          buttonRef={handles.left}
          onToggle={() => toggle("left")}
        />
        <ResizableHandle aria-label={text.left.resize} />
        <ResizablePanel id={ids.center} ref={panels.center} minSize={`${centerMinWidth}px`}>
          {center}
        </ResizablePanel>
        <ResizableHandle aria-label={text.right.resize} />
        <HandleSlot
          side="right"
          rtl={rtl}
          labels={text.right}
          collapsed={collapsed.right}
          controls={ids.right}
          icon={<Settings2 />}
          buttonRef={handles.right}
          onToggle={() => toggle("right")}
        />
        <EdgePanel side="right" id={ids.right} panelRef={panels.right} size={rightSize} initialSize={initialSize("right")} label={text.right.region} onCollapsed={reportCollapsed}>
          {right}
        </EdgePanel>
      </Resizable>
    </div>
  );
}

type EdgePanelProps = {
  side: EditorLayoutSide;
  id: string;
  panelRef: RefObject<HTMLDivElement | null>;
  size: EditorLayoutPanelSize;
  initialSize: `${number}px`;
  label: string;
  children: ReactNode;
  onCollapsed: (side: EditorLayoutSide, collapsed: boolean) => void;
};

function EdgePanel({ side, id, panelRef, size, initialSize, label, children, onCollapsed }: EdgePanelProps) {
  return (
    <ResizablePanel
      id={id}
      ref={panelRef}
      defaultSize={initialSize}
      minSize={`${size.min}px`}
      maxSize={`${size.max}px`}
      collapsible
      className="bg-panel"
      render={(props, state) => (
        <div {...props}>
          <CollapseReporter side={side} collapsed={state.collapsed} onCollapsed={onCollapsed} />
          {props.children}
        </div>
      )}
    >
      <aside aria-label={label} className="size-full">
        {children}
      </aside>
    </ResizablePanel>
  );
}

type CollapseReporterProps = {
  side: EditorLayoutSide;
  collapsed: boolean;
  onCollapsed: (side: EditorLayoutSide, collapsed: boolean) => void;
};

function CollapseReporter({ side, collapsed, onCollapsed }: CollapseReporterProps) {
  useEffect(() => {
    onCollapsed(side, collapsed);
  }, [side, collapsed]);
  return null;
}

type HandleSlotProps = {
  side: EditorLayoutSide;
  rtl: boolean;
  labels: EditorLayoutPanelLabels;
  collapsed: boolean;
  controls: string;
  icon: ReactNode;
  buttonRef: RefObject<HTMLButtonElement | null>;
  onToggle: () => void;
};

function HandleSlot({ side, rtl, labels, collapsed, controls, icon, buttonRef, onToggle }: HandleSlotProps) {
  const label = collapsed ? labels.show : labels.hide;
  const start = side === "left";
  return (
    <div className="relative z-10 w-0 shrink-0 self-stretch">
      <div className={cn("absolute top-1/2 -translate-y-1/2", start ? "start-0" : "end-0")}>
        <Tooltip content={label} side={start !== rtl ? "right" : "left"} arrow>
          <PanelHandle
            ref={buttonRef}
            side={start ? "start" : "end"}
            aria-label={label}
            expanded={!collapsed}
            controls={controls}
            icon={icon}
            onClick={onToggle}
          />
        </Tooltip>
      </div>
    </div>
  );
}
