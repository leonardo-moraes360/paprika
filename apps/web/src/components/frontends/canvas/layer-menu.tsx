import { centerContentOps, contentTarget, copyOwner, isScene, type Document } from "@paprika/core";
import { createMenuController } from "@ui-sdk/react/menu";
import { Circle, Component, Diamond, Frame, Group, Image, MoveUpRight, PenTool, RectangleHorizontal, Square, Type, type LucideIcon } from "lucide-react";
import { useState, type MouseEvent, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Kbd } from "@/components/ui/kbd";
import { Menu, MenuCheckboxItem, MenuContent, MenuItem, MenuSeparator, shortcutKeys } from "@/components/ui/menu";
import type { CanvasProps, CanvasRuntime } from "./types";

/** The key the editor binds to "centre content" (`editor/shortcuts.ts`): the menu shows it, the key itself is the editor's. */
const CENTER_KEY = "Alt+C";

type Payload = {
  /** The layers under the pointer, topmost first. */
  ids: readonly string[];
  /** The rectangle or ellipse that can become a path. */
  convert: string | null;
  /** The layers whose content can be centred, and whether it already is. */
  center: { ids: readonly string[]; centered: boolean } | null;
};

const icons: Record<string, LucideIcon> = { frame: Frame, rect: RectangleHorizontal, ellipse: Circle, text: Type, image: Image, path: PenTool, group: Group, shape: Square, connector: MoveUpRight };

/** The layers under a screen point, topmost first (what the browser says is stacked there; a node the document has). */
export function layersUnderPoint(rt: CanvasRuntime, clientX: number, clientY: number): string[] {
  const vp = rt.viewport();
  if (!vp || typeof document.elementsFromPoint !== "function") return [];
  const doc = rt.doc();
  const ids: string[] = [];
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    const host = el.closest<HTMLElement | SVGElement>("[data-paprika-id]");
    const id = host?.dataset.paprikaId;
    if (!host || !id || !vp.contains(host) || ids.includes(id) || !isScene(doc.nodes[id])) continue;
    ids.push(id);
  }
  return ids;
}

function payloadFor(doc: Document, ids: readonly string[], selection: readonly string[]): Payload {
  const convert = ids.find((id) => {
    const node = doc.nodes[id];
    return !!node && (node.type === "rect" || node.type === "ellipse") && !copyOwner(doc, node);
  });
  const centerable = (id: string) => {
    const kind = contentTarget(doc, doc.nodes[id])?.kind;
    return kind === "frame" || kind === "shape";
  };
  const picked = selection.filter(centerable);
  const targets = picked.length ? picked : ids.filter(centerable).slice(0, 1);
  return { ids, convert: convert ?? null, center: targets.length ? { ids: targets, centered: centerContentOps(doc, targets).centered } : null };
}

/**
 * The menu of the right button: the layers under the pointer (pick one to select it), centre content and convert to path.
 * The menu is the one of `ui/menu`; what it does with the layers goes out through `onCenterContent` and `onConvertToPath`.
 */
export function useLayerMenu(rt: CanvasRuntime, props: RefObject<CanvasProps>): { onContextMenu: (event: MouseEvent) => void; element: ReactNode } {
  const { t } = useTranslation();
  const [controller] = useState(() => createMenuController<Payload>());
  const onContextMenu = (event: MouseEvent) => {
    if (rt.tool() !== "select") return;
    const ids = layersUnderPoint(rt, event.clientX, event.clientY);
    if (ids.length === 0) return;
    event.preventDefault();
    void controller.open({ payload: payloadFor(rt.doc(), ids, rt.selection()), anchor: { x: event.clientX, y: event.clientY } });
  };
  const onAction = (value: unknown) => {
    const payload = controller.getPayload();
    const key = String(value);
    if (!payload) return;
    if (key.startsWith("layer:")) rt.select([key.slice(6)]);
    else if (key === "convert" && payload.convert) {
      props.current?.onConvertToPath?.([payload.convert]);
      rt.select([payload.convert]);
    }
  };
  // A checkbox item reports through `onCheckedChange`, not through the menu's `onAction`.
  const onCenter = () => {
    const payload = controller.getPayload();
    if (payload?.center) props.current?.onCenterContent?.(payload.center.ids);
  };
  const element = (
    <Menu controller={controller} pendingAnnouncement={t("common.working")} onAction={onAction}>
      <MenuContent aria-label={t("frontends.canvas.select.menu.label")}>
        {(state: { payload?: unknown }) => {
          const payload = state.payload as Payload | undefined;
          if (!payload) return null;
          const doc = rt.doc();
          return (
            <>
              {payload.ids.map((id) => {
                const node = doc.nodes[id];
                const Icon = (node?.type === "frame" && node.component ? Component : node?.type === "frame" && node.instanceOf ? Diamond : node ? icons[node.type] : undefined) ?? Square;
                return (
                  <MenuItem key={id} value={`layer:${id}`} icon={<Icon aria-hidden="true" />} data-layer-id={id}>
                    {node && "name" in node && node.name ? node.name : id}
                  </MenuItem>
                );
              })}
              {payload.center || payload.convert ? <MenuSeparator /> : null}
              {payload.center ? (
                <MenuCheckboxItem value="center" checked={!payload.center.centered} onCheckedChange={onCenter} closeOnSelect aria-keyshortcuts={CENTER_KEY} data-testid="center-content">
                  <span className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate">{t("frontends.canvas.select.menu.center")}</span>
                    <span aria-hidden="true" className="flex shrink-0 gap-1">
                      {shortcutKeys(CENTER_KEY).map((key, index) => (
                        <Kbd key={`${index}-${key}`}>{key}</Kbd>
                      ))}
                    </span>
                  </span>
                </MenuCheckboxItem>
              ) : null}
              {payload.convert ? (
                <MenuItem value="convert" data-testid="convert-to-path">
                  {t("frontends.canvas.select.menu.convert")}
                </MenuItem>
              ) : null}
            </>
          );
        }}
      </MenuContent>
    </Menu>
  );
  return { onContextMenu, element };
}
