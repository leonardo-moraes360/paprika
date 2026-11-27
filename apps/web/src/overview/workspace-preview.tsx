import type { PreviewShape } from "@/data/queries/workspaces";

/** The server's thumbnail of a workspace (up to a few dozen rectangles with their fills), fitted to the card. Pure SVG. */
export function WorkspacePreview({ shapes }: { shapes: readonly PreviewShape[] }) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of shapes) {
    minX = Math.min(minX, s.x);
    minY = Math.min(minY, s.y);
    maxX = Math.max(maxX, s.x + s.w);
    maxY = Math.max(maxY, s.y + s.h);
  }
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const pad = span * 0.08;
  const viewBox = `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`;
  return (
    <svg viewBox={viewBox} preserveAspectRatio="xMidYMid meet" aria-hidden="true" className="size-full bg-canvas">
      {shapes.map((s, i) => (
        <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} fill={s.fill} rx={Math.min(s.w, s.h) * 0.08} />
      ))}
    </svg>
  );
}
