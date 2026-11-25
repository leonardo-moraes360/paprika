import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Download, Ellipsis, GripVertical, Redo2, Undo2, type LucideIcon } from "lucide-react";
import { Button } from "./components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import { Separator } from "./components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "./components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/ui/tooltip";
import { cn } from "./lib/cn";
import type { Tool } from "./Canvas";
import { useT } from "./i18n";

export type ToolbarDock = "top" | "left" | "right" | "bottom";

const STORAGE_KEY = "paprika.toolbar.dock";
const DOCKS: ToolbarDock[] = ["top", "left", "right", "bottom"];
const TOOL_ICON = 18;

const toolItemClass =
  "h-[30px] w-8 shrink-0 rounded-md border-0 bg-transparent p-0 text-ui-foreground hover:bg-ui-secondary hover:text-ui-foreground data-[state=on]:bg-accent-strong data-[state=on]:text-white data-[state=on]:hover:bg-accent-strong data-[state=on]:hover:text-white [&_svg]:size-[18px]";
const actionItemClass =
  "inline-flex h-[30px] w-8 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-ui-foreground hover:bg-ui-secondary disabled:cursor-default disabled:opacity-35 [&_svg]:size-[18px]";

export function readToolbarDock(): ToolbarDock {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const safe = DOCKS.find((item) => item === raw);
    if (safe) return safe;
  } catch {
  }
  return "top";
}

function saveToolbarDock(dock: ToolbarDock) {
  const safe = DOCKS.find((item) => item === dock);
  if (!safe) return;
  try {
    localStorage.setItem(STORAGE_KEY, safe);
  } catch {
  }
}

function dockFromPoint(x: number, y: number, rect: DOMRect): ToolbarDock {
  const left = x - rect.left;
  const right = rect.right - x;
  const top = y - rect.top;
  const bottom = rect.bottom - y;
  const min = Math.min(left, right, top, bottom);
  if (min === left) return "left";
  if (min === right) return "right";
  if (min === bottom) return "bottom";
  return "top";
}

export function Toolbar({
  tools,
  tool,
  onTool,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onExport,
  dock,
  onDock,
}: {
  tools: { tool: Tool; key: string; label: string; icon: LucideIcon }[];
  tool: Tool;
  onTool: (tool: Tool) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onExport: () => void;
  dock: ToolbarDock;
  onDock: (dock: ToolbarDock) => void;
}) {
  const m = useT();
  const vertical = dock === "left" || dock === "right";
  const tipSide = dock === "left" ? "right" : dock === "right" ? "left" : dock === "bottom" ? "top" : "bottom";
  const drag = useRef<{ pointerId: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const setDock = useCallback(
    (next: ToolbarDock) => {
      onDock(next);
      saveToolbarDock(next);
    },
    [onDock],
  );

  useEffect(() => {
    if (!dragging) return;
    const prev = document.body.style.cursor;
    document.body.style.cursor = "grabbing";
    return () => {
      document.body.style.cursor = prev;
    };
  }, [dragging]);

  const onGripPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { pointerId: e.pointerId };
    setDragging(true);
  };

  const onGripPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag.current || drag.current.pointerId !== e.pointerId) return;
    const main = e.currentTarget.closest("main");
    if (!main) return;
    const next = dockFromPoint(e.clientX, e.clientY, main.getBoundingClientRect());
    if (next !== dock) setDock(next);
  };

  const endGrip = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag.current || drag.current.pointerId !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
    }
  };

  return (
    <TooltipProvider delayDuration={400}>
      <nav
        className={cn(
          "absolute z-10 flex gap-0.5 rounded-xl border border-ui-border bg-ui-card p-1 shadow-float",
          vertical ? "flex-col items-center" : "flex-row items-center",
          dock === "top" && "top-3 left-1/2 -translate-x-1/2",
          dock === "bottom" && "bottom-3 left-1/2 -translate-x-1/2",
          dock === "left" && "top-1/2 left-3 -translate-y-1/2",
          dock === "right" && "top-1/2 right-3 -translate-y-1/2",
          dragging && "opacity-90",
        )}
        aria-label={m.tools}
        data-toolbar-dock={dock}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={cn(
                "inline-flex shrink-0 cursor-grab items-center justify-center rounded-md border-0 bg-transparent text-ui-muted-foreground hover:bg-ui-secondary hover:text-ui-foreground active:cursor-grabbing",
                vertical ? "h-4 w-8" : "h-[30px] w-4",
              )}
              aria-label={m.toolbarDrag}
              data-toolbar-grip
              onPointerDown={onGripPointerDown}
              onPointerMove={onGripPointerMove}
              onPointerUp={endGrip}
              onPointerCancel={endGrip}
            >
              <GripVertical size={16} strokeWidth={1.75} className={cn(vertical && "rotate-90")} aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent side={tipSide}>{m.toolbarDragHint}</TooltipContent>
        </Tooltip>
        <ToggleGroup
          type="multiple"
          rovingFocus={false}
          value={[tool]}
          onValueChange={(next) => {
            const added = next.find((v) => v !== tool);
            if (added) onTool(added as Tool);
          }}
          className={cn("gap-0.5", vertical && "flex-col")}
        >
          {tools.map((t) => (
            <Tooltip key={t.tool}>
              <TooltipTrigger asChild>
                <ToggleGroupItem
                  value={t.tool}
                  className={cn(toolItemClass, tool === t.tool && "is-active")}
                  aria-label={t.label}
                >
                  <t.icon size={TOOL_ICON} strokeWidth={1.75} aria-hidden />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent side={tipSide}>{`${t.label} (${t.key.toUpperCase()})`}</TooltipContent>
            </Tooltip>
          ))}
        </ToggleGroup>
        <Separator orientation={vertical ? "horizontal" : "vertical"} className={vertical ? "my-1.5 w-5" : "mx-1.5 h-5"} />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" className={actionItemClass} onClick={onUndo} disabled={!canUndo} aria-label={m.undo}>
              <Undo2 size={TOOL_ICON} strokeWidth={1.75} aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent side={tipSide}>{m.undoHint}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" className={actionItemClass} onClick={onRedo} disabled={!canRedo} aria-label={m.redo}>
              <Redo2 size={TOOL_ICON} strokeWidth={1.75} aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent side={tipSide}>{m.redoHint}</TooltipContent>
        </Tooltip>
        <Separator orientation={vertical ? "horizontal" : "vertical"} className={vertical ? "my-1.5 w-5" : "mx-1.5 h-5"} />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" className={actionItemClass} onClick={onExport} aria-label={m.exportSvg}>
              <Download size={TOOL_ICON} strokeWidth={1.75} aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent side={tipSide}>{m.exportSvgHint}</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className={actionItemClass} aria-label={m.toolbarMenu}>
                  <Ellipsis size={TOOL_ICON} strokeWidth={1.75} aria-hidden />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side={tipSide}>{m.toolbarPosition}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent side={tipSide} align="center">
            <DropdownMenuLabel>{m.toolbarDockLabel}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value={dock} onValueChange={(v) => setDock(v as ToolbarDock)}>
              {DOCKS.map((d) => (
                <DropdownMenuRadioItem key={d} value={d}>
                  {d === "top" ? m.dockTop : d === "left" ? m.dockLeft : d === "right" ? m.dockRight : m.dockBottom}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>
    </TooltipProvider>
  );
}
