import { Circle, Component, Diamond, Frame, Group, Image, MoveUpRight, PenTool, RectangleHorizontal, Square, Type, type LucideIcon } from "lucide-react";
import type { LayerKind } from "./types";

export const layerIcons: Record<LayerKind, LucideIcon> = {
  frame: Frame,
  rect: RectangleHorizontal,
  ellipse: Circle,
  text: Type,
  image: Image,
  path: PenTool,
  group: Group,
  component: Component,
  instance: Diamond,
  shape: Square,
  connector: MoveUpRight,
};

const containers = new Set<LayerKind>(["frame", "group", "component"]);

export const isContainerKind = (kind: LayerKind) => containers.has(kind);
