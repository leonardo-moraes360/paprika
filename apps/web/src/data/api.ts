/** The only HTTP entry point of the app: every request goes through here (rule: network only in `src/data/**`). */

export type ApiErrorCode = "http" | "invalid-response" | "network";

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly path: string;

  constructor(code: ApiErrorCode, message: string, status: number, path: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.path = path;
  }
}

export const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

const isJson = (response: Response) => (response.headers.get("content-type") ?? "").includes("json");

/**
 * JSON request. A server error answers `{error}` and becomes an `ApiError` with that message. A successful answer
 * that is not JSON (the server falls back to the SPA shell for unknown routes) is an `invalid-response` error.
 */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch (error) {
    if (init?.signal?.aborted) throw error;
    throw new ApiError("network", errorText(error), 0, path);
  }
  let body: unknown = null;
  if (isJson(response)) {
    try {
      body = await response.json();
    } catch {
      body = null;
    }
  }
  if (!response.ok) {
    const message = (body as { error?: unknown } | null)?.error;
    throw new ApiError("http", typeof message === "string" && message ? message : response.statusText || `HTTP ${response.status}`, response.status, path);
  }
  if (body === null) throw new ApiError("invalid-response", `Invalid response from ${path}`, response.status, path);
  return body as T;
}

export const jsonRequest = (method: "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
});

/** `GET /api/team`: only exists with `paprika serve --team`. Anything that is not a JSON 2xx answer means "no team" (`null`). */
export async function fetchTeamStatus(signal?: AbortSignal): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch("/api/team", { signal });
    if (!response.ok || !isJson(response)) return null;
    const body: unknown = await response.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const workspacePath = (id: string) => `/api/workspaces/${encodeURIComponent(id)}`;
