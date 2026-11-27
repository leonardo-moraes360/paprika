import { api, ApiError, errorText, workspacePath } from "../api";

/**
 * Image export. `/api/svg` and `/api/screenshot` render the ACTIVE workspace of the server, and a `view` over the
 * socket does not make a workspace active, so the workspace in view is made active first when it is not.
 */
async function ensureActive(workspaceId: string, signal?: AbortSignal) {
  const list = await api<{ active?: string }>("/api/workspaces", { signal });
  if (list.active !== workspaceId) await api(`${workspacePath(workspaceId)}/open`, { method: "POST", signal });
}

const rootQuery = (rootId: string | null) => (rootId ? `root=${encodeURIComponent(rootId)}` : "");

export type SvgExport = { svg: string; width: number; height: number; warnings: string[] };

export async function fetchSvg(workspaceId: string, rootId: string | null, signal?: AbortSignal): Promise<SvgExport> {
  await ensureActive(workspaceId, signal);
  const body = await api<Partial<SvgExport>>(`/api/svg${rootId ? `?${rootQuery(rootId)}` : ""}`, { signal });
  if (!body.svg) throw new ApiError("invalid-response", "The server returned no SVG.", 200, "/api/svg");
  return { svg: body.svg, width: body.width ?? 0, height: body.height ?? 0, warnings: body.warnings ?? [] };
}

/** `GET /api/screenshot`: a PNG, or `{error}` (for example "screenshot unavailable on this server"). */
export async function fetchPng(workspaceId: string, rootId: string | null, scale: number, signal?: AbortSignal): Promise<Blob> {
  await ensureActive(workspaceId, signal);
  const query = [rootQuery(rootId), `scale=${encodeURIComponent(String(scale))}`].filter(Boolean).join("&");
  let response: Response;
  try {
    response = await fetch(`/api/screenshot?${query}`, { signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError("network", errorText(error), 0, "/api/screenshot");
  }
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || !type.includes("image/png")) {
    let message = response.statusText || `HTTP ${response.status}`;
    if (type.includes("json")) {
      const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
      if (typeof body?.error === "string" && body.error) message = body.error;
    }
    throw new ApiError("http", message, response.status, "/api/screenshot");
  }
  return response.blob();
}
