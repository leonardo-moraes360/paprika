import i18n from "i18next";
import { api, ApiError, isGatewayStatus, noServer } from "../api";

/**
 * Image export never changes the workspace the server has open (that one is shared with every other editor and with
 * the MCP agents). SVG is made in the client (`exportSVG` of `@paprika/core`, see `adapters/export.ts`). The PNG
 * is the only thing asked of the server, and `/api/screenshot` draws the ACTIVE workspace, so it is asked only when the
 * workspace in view is that one (`/api/health` says which it is). The two requests are not atomic (the server has no
 * `?workspaceId=` for the screenshot), so `/api/health` is read again once the PNG is in and the image is dropped if the
 * active workspace changed meanwhile.
 */
async function ensureViewIsActive(workspaceId: string, signal?: AbortSignal) {
  const health = await api<{ docId?: string }>("/api/health", { signal });
  if (health.docId !== workspaceId) throw new ApiError("http", i18n.t("app.collab.export.pngInactive"), 409, "/api/screenshot");
}

const rootQuery = (rootId: string | null) => (rootId ? `root=${encodeURIComponent(rootId)}` : "");

/** `GET /api/screenshot`: a PNG, or `{error}` (for example "screenshot unavailable on this server"). */
export async function fetchPng(workspaceId: string, rootId: string | null, scale: number, signal?: AbortSignal): Promise<Blob> {
  await ensureViewIsActive(workspaceId, signal);
  const query = [rootQuery(rootId), `scale=${encodeURIComponent(String(scale))}`].filter(Boolean).join("&");
  let response: Response;
  try {
    response = await fetch(`/api/screenshot?${query}`, { signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError("network", noServer(), 0, "/api/screenshot");
  }
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || !type.includes("image/png")) {
    if (isGatewayStatus(response.status)) throw new ApiError("network", noServer(), response.status, "/api/screenshot");
    let message = response.statusText || `HTTP ${response.status}`;
    if (type.includes("json")) {
      const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
      if (typeof body?.error === "string" && body.error) message = body.error;
    }
    throw new ApiError("http", message, response.status, "/api/screenshot");
  }
  const blob = await response.blob();
  await ensureViewIsActive(workspaceId, signal);
  return blob;
}
