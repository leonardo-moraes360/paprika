export type CaptureParams = { id: string; page: string | null };

/**
 * `?capture=<id>&page=<page>`: how the server's screenshot opens the canvas on one node (see `ScreenshotWASM` in
 * `server/internal/server/screenshot_canvas.go`). Read once per editor, from the address of the window.
 */
export function readCaptureParams(search: string = typeof window === "undefined" ? "" : window.location.search): CaptureParams | null {
  const query = new URLSearchParams(search);
  const id = query.get("capture");
  return id ? { id, page: query.get("page") } : null;
}
