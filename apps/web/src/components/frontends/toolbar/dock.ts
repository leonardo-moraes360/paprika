import type { PersistedCodec } from "@/lib/persist";
import { toolbarDocks, type ToolbarDock } from "./types";

export const isDock = (value: unknown): value is ToolbarDock => toolbarDocks.some((dock) => dock === value);

export const dockCodec: PersistedCodec<ToolbarDock> = {
  parse: (raw) => (isDock(raw) ? raw : null),
  serialize: (value) => value,
};

type Box = { left: number; top: number; right: number; bottom: number };

export function dockFromPoint(x: number, y: number, box: Box): ToolbarDock {
  const first: [ToolbarDock, number] = ["left", x - box.left];
  const edges: [ToolbarDock, number][] = [
    first,
    ["right", box.right - x],
    ["top", y - box.top],
    ["bottom", box.bottom - y],
  ];
  const nearest = edges.reduce((best, edge) => (edge[1] < best[1] ? edge : best), first);
  return nearest[0];
}

export const dockPlacement: Record<ToolbarDock, string> = {
  top: "top-4 left-1/2 -translate-x-1/2",
  bottom: "bottom-4 left-1/2 -translate-x-1/2",
  left: "left-10 top-1/2 -translate-y-1/2",
  right: "right-10 top-1/2 -translate-y-1/2",
};

export const dockSide: Record<ToolbarDock, "top" | "right" | "bottom" | "left"> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};
