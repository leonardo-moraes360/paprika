import { useLayoutEffect, useRef } from "react";
import { Pin } from "@/components/ui/pin";
import { PinBadge } from "@/components/ui/pin-bubble";
import type { AgentColor } from "@/components/ui/agent-tone";
import { useCollab, type CanvasPin } from "../collab";
import { PIN_DRAG_KEY } from "../gestures/pin-place";
import { useOverlayValue } from "../overlay-bus";
import { useCanvasRuntime, type CanvasRuntime } from "../runtime";
import { coveredBox } from "../geometry";
import type { Box } from "../types";
import { dashedRing, ring } from "./stroke";
import { useDocVersion } from "./use-doc-version";

const toneVar: Record<AgentColor, string> = { "agent-1": "var(--color-agent-1)", "agent-2": "var(--color-agent-2)", "agent-3": "var(--color-agent-3)", "agent-4": "var(--color-agent-4)" };
const ACTION = "var(--color-action)";

/** The outline of a pin's mark: solid for an element, dashed for an area. */
const markEdge = (area: boolean, color: string) => (area ? dashedRing(2, color) : ring(2, color));

/** A pin shows on the page it was made on; one with no page shows on every page. */
export const pinOnPage = (pin: Pick<CanvasPin, "pageId">, pageId: string | null) => !pin.pageId || pin.pageId === pageId;

/** The box a pin points at: its node's box while the node is on the page, else where the pin was made. */
export function pinBox(rt: CanvasRuntime, pin: Pick<CanvasPin, "nodeId" | "region">): Box {
  const measured = pin.nodeId ? rt.measure(pin.nodeId) : null;
  return measured ? coveredBox(measured) : pin.region;
}


/** Writes a box onto an outline and a badge (at the top-right corner of a node, the top-left one of an area). */
function placeMark(outline: HTMLElement | null, badge: HTMLElement | null, box: Box, area: boolean) {
  if (outline) {
    const show = box.width > 0 || box.height > 0;
    outline.style.display = show ? "block" : "none";
    outline.style.left = `${box.x}px`;
    outline.style.top = `${box.y}px`;
    outline.style.width = `${box.width}px`;
    outline.style.height = `${box.height}px`;
  }
  if (badge) {
    badge.style.left = `${area ? box.x : box.x + box.width}px`;
    badge.style.top = `${box.y}px`;
  }
}

const badgeShell = "pointer-events-none absolute z-10 origin-center -translate-x-1/2 -translate-y-1/2";
const BADGE_SCALE = { transformOrigin: "center", scale: "calc(1 / var(--view-zoom))" } as const;

/**
 * The pins of the page, as the old canvas showed them: an outline around what each points at (solid for an element, dashed for
 * an area) and a numbered badge that selects it in the list. A resolved pin is not here. Boxes are measured after each commit that
 * painted something and written to the elements, so a node that moves takes its pin along without a render of ours.
 */
export function Pins() {
  const rt = useCanvasRuntime();
  const pins = useCollab(rt.collab, (c) => c.pins);
  const selected = useCollab(rt.collab, (c) => c.pinId);
  const docVersion = useDocVersion();
  const marks = useRef(new Map<string, { outline: HTMLElement | null; badge: HTMLElement | null }>());
  const pageId = rt.pageId();
  const shown = pins.filter((pin) => pinOnPage(pin, pageId));

  useLayoutEffect(() => {
    const boxes = shown.map((pin) => pinBox(rt, pin));
    shown.forEach((pin, i) => {
      const mark = marks.current.get(pin.id);
      if (mark) placeMark(mark.outline, mark.badge, boxes[i] as Box, !pin.nodeId);
    });
  });
  // `docVersion` and the page are why the layout effect above runs again; they are read here so the component renders on them.
  void docVersion;

  return (
    <div data-testid="pins-layer">
      {shown.map((pin) => {
        const claimed = pin.status === "claimed";
        const entry = (key: "outline" | "badge") => (el: HTMLElement | null) => {
          const mark = marks.current.get(pin.id) ?? { outline: null, badge: null };
          mark[key] = el;
          if (el) marks.current.set(pin.id, mark);
          else if (!mark.outline && !mark.badge) marks.current.delete(pin.id);
        };
        return (
          <div key={pin.id} data-pin={pin.number} data-pin-status={pin.status}>
            <div
              ref={entry("outline")}
              aria-hidden="true"
              className={`pointer-events-none absolute hidden rounded-md ${pin.nodeId ? "" : "bg-action/10"}`}
              style={markEdge(!pin.nodeId, claimed && pin.tone ? toneVar[pin.tone] : ACTION)}
            />
            <div ref={entry("badge")} className={badgeShell} style={BADGE_SCALE}>
              <Pin
                aria-label={pin.label}
                aria-pressed={selected === pin.id}
                number={pin.number}
                status={pin.status}
                tone={pin.tone}
                data-testid="pin-badge"
                className={`pointer-events-auto ${selected === pin.id ? "outline-2 outline-offset-2 outline-select-brand" : ""}`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => rt.pinSelect(pin.id)}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * What the pin tool is drawing: the area while it is dragged (dashed, nothing else) and, once the person has pointed at something, the
 * outline and the badge the new pin will have (the form for it is the pins region's).
 */
export function PinDraft() {
  const rt = useCanvasRuntime();
  const drag = useOverlayValue<Box>(PIN_DRAG_KEY);
  const draft = useCollab(rt.collab, (c) => c.pinDraft);
  const docVersion = useDocVersion();
  const outline = useRef<HTMLDivElement>(null);
  const badge = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (draft) placeMark(outline.current, badge.current, pinBox(rt, draft), !draft.nodeId);
  }, [rt, draft, docVersion]);

  return (
    <>
      {drag ? <div data-testid="pin-drag" aria-hidden="true" className="pointer-events-none absolute rounded-md bg-action/10" style={{ ...markEdge(true, ACTION), left: drag.x, top: drag.y, width: drag.width, height: drag.height }} /> : null}
      {draft ? (
        <div data-testid="pin-draft">
          <div ref={outline} aria-hidden="true" className={`pointer-events-none absolute hidden rounded-md ${draft.nodeId ? "" : "bg-action/10"}`} style={markEdge(!draft.nodeId, ACTION)} />
          <div ref={badge} aria-hidden="true" className={badgeShell} style={BADGE_SCALE}>
            <PinBadge number={draft.number} />
          </div>
        </div>
      ) : null}
    </>
  );
}

