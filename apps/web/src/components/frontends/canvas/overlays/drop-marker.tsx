import type { DropUi } from "../drop";
import { useOverlayValue } from "../overlay-bus";

/** While a node is dragged: the container it would go into (a ring, as the layers panel draws "drop inside") and, in an auto-layout flow, the bar between two siblings ("drop between"). */
export function DropMarker() {
  const drop = useOverlayValue<DropUi>("drop");
  if (!drop) return null;
  const { highlight, marker } = drop;
  return (
    <>
      <div
        data-testid="drop-target"
        className="pointer-events-none absolute border-select-brand"
        style={{ left: highlight.x, top: highlight.y, width: highlight.width, height: highlight.height, borderWidth: "calc(2px / var(--view-zoom))" }}
      />
      {marker ? (
        <div data-testid="drop-marker" className="pointer-events-none absolute rounded-sm bg-select-brand" style={{ left: marker.x, top: marker.y, width: marker.width, height: marker.height }} />
      ) : null}
    </>
  );
}
