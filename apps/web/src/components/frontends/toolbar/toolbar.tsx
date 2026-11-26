import { useHotkeys } from "@tanstack/react-hotkeys";
import { bindDrag, dragThreshold } from "@ui-sdk/core";
import { createMenuController } from "@ui-sdk/react/menu";
import { Ellipsis, GripVertical, Redo2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Menu, MenuContent, MenuGroup, MenuGroupLabel, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { ToolbarButton } from "@/components/ui/toolbar-button";
import { Toolbar as ToolbarSurface, ToolbarSeparator } from "@/components/ui/toolbar-group";
import { Tooltip } from "@/components/ui/tooltip";
import { usePersistedState } from "@/lib/use-persisted-state";
import { cn } from "@/lib/utils";
import { dockCodec, dockFromPoint, dockPlacement, dockSide, isDock } from "./dock";
import { ToolItem } from "./tool-item";
import { toolbarDocks, type ToolbarDock, type ToolbarProps } from "./types";

export function Toolbar({
  tools,
  value,
  onValueChange,
  canUndo = true,
  canRedo = true,
  onUndo,
  onRedo,
  onHistory,
  onImport,
  onExport,
  dock,
  defaultDock = "top",
  onDockChange,
  storageKey,
  shortcuts = true,
  shortcutTarget,
  className,
}: ToolbarProps) {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const grip = useRef<HTMLButtonElement>(null);
  const hint = useRef<HTMLDivElement>(null);
  const [storedDock, setStoredDock] = usePersistedState(dock === undefined ? storageKey : undefined, defaultDock, dockCodec);
  const current = dock ?? storedDock;
  const [last, setLast] = useState<Record<string, string>>({});
  const stop = useRef<(() => void) | null>(null);
  const [positionMenu] = useState(() => createMenuController());
  const vertical = current === "left" || current === "right";
  const side = dockSide[current];

  useEffect(() => () => stop.current?.(), []);

  const select = useCallback(
    (id: string) => {
      const owner = tools.find((tool) => tool.options?.some((option) => option.id === id));
      if (owner) setLast((previous) => ({ ...previous, [owner.id]: id }));
      onValueChange(id);
    },
    [tools, onValueChange],
  );

  const changeDock = (next: ToolbarDock) => {
    if (next === current) return;
    if (dock === undefined) setStoredDock(next);
    onDockChange?.(next);
  };

  const definitions = useMemo(() => {
    const list: { hotkey: string; callback: () => void }[] = [];
    for (const tool of tools) {
      if (tool.options) {
        if (tool.hotkey) {
          list.push({
            hotkey: tool.hotkey,
            callback: () => select(last[tool.id] ?? tool.options?.[0]?.id ?? tool.id),
          });
        }
        for (const option of tool.options) if (option.hotkey) list.push({ hotkey: option.hotkey, callback: () => select(option.id) });
      } else if (tool.hotkey) list.push({ hotkey: tool.hotkey, callback: () => select(tool.id) });
    }
    return list;
  }, [tools, last, select]);

  // Without `shortcutTarget` the keys listen on the element the toolbar is docked in (its stage), not on the toolbar alone.
  const stage = useMemo<RefObject<HTMLElement | null>>(
    () => ({
      get current() {
        return root.current?.parentElement ?? root.current;
      },
    }),
    [],
  );
  const target = shortcutTarget ?? stage;
  const hotkeyOptions = { target, ignoreInputs: true, enabled: shortcuts } as const;
  useHotkeys(
    definitions.map(({ hotkey, callback }) => ({ hotkey: hotkey as never, callback })),
    hotkeyOptions,
  );
  // Each key is claimed only when the owner gave it a handler, so the browser keeps the ones that would do nothing here.
  useHotkeys(
    [
      ...(onUndo ? [{ hotkey: "Mod+Z" as const, callback: () => canUndo && onUndo() }] : []),
      ...(onRedo
        ? [
            { hotkey: "Mod+Y" as const, callback: () => canRedo && onRedo() },
            { hotkey: "Mod+Shift+Z" as const, callback: () => canRedo && onRedo() },
          ]
        : []),
      ...(onHistory ? [{ hotkey: "Mod+H" as const, callback: () => onHistory() }] : []),
      ...(onImport ? [{ hotkey: "Mod+O" as const, callback: () => onImport() }] : []),
      ...(onExport ? [{ hotkey: "Mod+E" as const, callback: () => onExport() }] : []),
    ],
    { ...hotkeyOptions, preventDefault: true },
  );

  const onGripPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const el = root.current;
    const box = el?.offsetParent?.getBoundingClientRect() ?? el?.parentElement?.getBoundingClientRect();
    if (event.button !== 0 || !el || !box) return;
    stop.current?.();
    let snap: ToolbarDock = current;
    const startX = event.clientX;
    const startY = event.clientY;
    const reset = () => {
      el.style.transform = "";
      if (hint.current) delete hint.current.dataset.snap;
      stop.current = null;
    };
    const release = bindDrag(event.currentTarget, event.nativeEvent, {
      threshold: dragThreshold,
      cancelOnEscape: true,
      onMove: ({ x, y }) => {
        el.style.transform = `translate(${x - startX}px, ${y - startY}px)`;
        snap = dockFromPoint(x, y, box);
        if (hint.current) hint.current.dataset.snap = snap;
      },
      onEnd: (_event, canceled) => {
        reset();
        if (!canceled) changeDock(snap);
      },
    });
    stop.current = () => {
      release();
      reset();
    };
  };

  return (
    <>
      <div
        ref={hint}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[9] hidden data-snap:block [&>span]:absolute [&>span]:rounded-md [&>span]:bg-select-soft [&>span]:opacity-0 [&>span]:transition-opacity motion-reduce:[&>span]:transition-none data-[snap=top]:[&>span:nth-child(1)]:opacity-100 data-[snap=bottom]:[&>span:nth-child(2)]:opacity-100 data-[snap=left]:[&>span:nth-child(3)]:opacity-100 data-[snap=right]:[&>span:nth-child(4)]:opacity-100"
      >
        <span className="inset-x-4 top-1 h-2" />
        <span className="inset-x-4 bottom-1 h-2" />
        <span className="inset-y-4 left-1 w-2" />
        <span className="inset-y-4 right-1 w-2" />
      </div>
      <div ref={root} data-dock={current} className={cn("absolute z-10", dockPlacement[current], className)}>
        <ToolbarSurface aria-label={t("frontends.toolbar.label")} orientation={vertical ? "vertical" : "horizontal"}>
          <Tooltip content={t("frontends.toolbar.gripHint")} side={side}>
            <ToolbarButton
              ref={grip}
              aria-label={t("frontends.toolbar.grip")}
              onPointerDown={onGripPointerDown}
              onClick={(event) => {
                // A click from Enter or Space (no pointer): the keyboard way to the position menu. A mouse click does nothing.
                if (event.detail === 0 && grip.current) void positionMenu.open({ anchor: grip.current });
              }}
              className={cn("cursor-grab touch-none active:cursor-grabbing", vertical ? "h-4 w-8" : "h-8 w-4")}
            >
              <GripVertical aria-hidden="true" className={cn("size-3.5!", vertical && "rotate-90")} />
            </ToolbarButton>
          </Tooltip>
          {tools.map((tool) => (
            <ToolSlot key={tool.id} separated={tool.separatorBefore}>
              <ToolItem tool={tool} value={value} lastOption={last[tool.id]} side={side} onValueChange={select} />
            </ToolSlot>
          ))}
          <ToolbarSeparator />
          <Menu
            controller={positionMenu}
            pendingAnnouncement={t("common.working")}
            onAction={(action) => {
              if (action === "undo") onUndo?.();
              else if (action === "redo") onRedo?.();
              else if (action === "history") onHistory?.();
              else if (action === "import-file") onImport?.();
              else if (action === "export") onExport?.();
            }}
          >
            <Tooltip content={t("frontends.toolbar.more")} side={side}>
              <MenuTrigger render={<ToolbarButton aria-label={t("frontends.toolbar.more")} />}>
                <Ellipsis aria-hidden="true" />
              </MenuTrigger>
            </Tooltip>
            <MenuContent side={side} align="center">
              <MenuItem value="undo" icon={<Undo2 />} shortcut="mod+z" disabled={!canUndo}>
                {t("frontends.toolbar.undo")}
              </MenuItem>
              <MenuItem value="redo" icon={<Redo2 />} shortcut="mod+y" disabled={!canRedo}>
                {t("frontends.toolbar.redo")}
              </MenuItem>
              {onHistory || onImport || onExport ? <MenuSeparator /> : null}
              {onHistory ? (
                <MenuItem value="history" shortcut="mod+h">
                  {t("frontends.toolbar.history")}
                </MenuItem>
              ) : null}
              {onImport ? (
                <MenuItem value="import-file" shortcut="mod+o">
                  {t("frontends.toolbar.importFile")}
                </MenuItem>
              ) : null}
              {onExport ? (
                <MenuItem value="export" shortcut="mod+e">
                  {t("frontends.toolbar.exportFile")}
                </MenuItem>
              ) : null}
              <MenuSeparator />
              <MenuGroup>
                <MenuGroupLabel>{t("frontends.toolbar.position")}</MenuGroupLabel>
                <MenuRadioGroup value={current} onValueChange={(next) => isDock(next) && changeDock(next)}>
                  {toolbarDocks.map((option) => (
                    <MenuRadioItem key={option} value={option}>
                      {t(`frontends.toolbar.dock.${option}`)}
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuGroup>
            </MenuContent>
          </Menu>
        </ToolbarSurface>
      </div>
    </>
  );
}

function ToolSlot({ separated, children }: { separated?: boolean; children: ReactNode }) {
  return (
    <>
      {separated ? <ToolbarSeparator /> : null}
      {children}
    </>
  );
}
