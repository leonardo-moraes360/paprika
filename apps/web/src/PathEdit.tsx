import { serializePath, subpathsToPath, type AnchorRef, type PathNode, type Subpath } from "@paprika/core";

export interface PathEditState {
  id: string;
  sel: AnchorRef | null;
  draft: Subpath[] | null;
  sent: Subpath[] | null;
  pending: string[];
}

export type PathHit = { kind: "anchor"; ref: AnchorRef } | { kind: "handle"; ref: AnchorRef; side: "in" | "out" } | { kind: "outline" };

export function pathHit(target: EventTarget | null): PathHit | null {
  const el = target instanceof Element ? target.closest<SVGElement>("[data-path-anchor], [data-path-handle], [data-path-outline]") : null;
  if (!el) return null;
  if (el.dataset.pathOutline !== undefined) return { kind: "outline" };
  const [sub, index, side] = (el.dataset.pathAnchor ?? el.dataset.pathHandle ?? "").split(":");
  const ref = { sub: Number(sub), index: Number(index) };
  if (!Number.isInteger(ref.sub) || !Number.isInteger(ref.index)) return null;
  return el.dataset.pathHandle !== undefined ? { kind: "handle", ref, side: side === "in" ? "in" : "out" } : { kind: "anchor", ref };
}

export function clientToPath(svg: SVGGraphicsElement, clientX: number, clientY: number) {
  const m = svg.getScreenCTM();
  if (!m) return { x: clientX, y: clientY };
  const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
  return { x: p.x, y: p.y };
}

export function pathScale(node: PathNode, zoom: number): number {
  if (!node.viewBox || typeof node.width !== "number" || typeof node.height !== "number") return zoom;
  return zoom * Math.min(node.width / node.viewBox[2], node.height / node.viewBox[3]);
}

export function PathEditOverlay({ subs, sel, scale }: { subs: Subpath[]; sel: AnchorRef | null; scale: number }) {
  const r = 4 / scale;
  const d = serializePath(subpathsToPath(subs));
  return (
    <g data-testid="path-edit">
      {d && <path d={d} fill="none" stroke="transparent" strokeWidth={10 / scale} data-path-outline="" style={{ pointerEvents: "stroke", cursor: "copy" }} />}
      {d && <path d={d} fill="none" stroke="var(--color-select)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" style={{ pointerEvents: "none" }} />}
      {subs.map((s, si) =>
        s.anchors.map((a, k) => {
          const isSel = sel?.sub === si && sel.index === k;
          return (
            <g key={`${si}:${k}`}>
              {(["in", "out"] as const).map((side) => {
                const h = a[side];
                if (!h) return null;
                return (
                  <g key={side}>
                    <line x1={a.x} y1={a.y} x2={h.x} y2={h.y} stroke="var(--color-select)" strokeWidth={1} vectorEffect="non-scaling-stroke" style={{ pointerEvents: "none" }} />
                    <circle cx={h.x} cy={h.y} r={r * 0.8} fill="#fff" stroke="var(--color-select)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" data-path-handle={`${si}:${k}:${side}`} style={{ cursor: "move" }} />
                  </g>
                );
              })}
              <rect
                x={a.x - r}
                y={a.y - r}
                width={2 * r}
                height={2 * r}
                fill={isSel ? "var(--color-select)" : "#fff"}
                stroke="var(--color-select)"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
                data-path-anchor={`${si}:${k}`}
                data-selected={isSel || undefined}
                style={{ cursor: "move" }}
              />
            </g>
          );
        }),
      )}
    </g>
  );
}
