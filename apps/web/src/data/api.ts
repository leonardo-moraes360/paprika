import i18n from "i18next";

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

/** The message of a server that cannot be reached: the request never got an answer, or a proxy in front answered 502, 503 or 504 (a body that is not the server's `{error}`). */
export const noServer = () => i18n.t("app.connection.noServer");
export const isGatewayStatus = (status: number) => status === 502 || status === 503 || status === 504;

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
    throw new ApiError("network", noServer(), 0, path);
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
    // 4xx keep the server's own message; a gateway status means the server is not there.
    if (isGatewayStatus(response.status)) throw new ApiError("network", noServer(), response.status, path);
    throw new ApiError("http", typeof message === "string" && message ? message : response.statusText || `HTTP ${response.status}`, response.status, path);
  }
  if (body === null) throw new ApiError("invalid-response", i18n.t("app.connection.invalidResponse", { path }), response.status, path);
  return body as T;
}

export const jsonRequest = (method: "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
});

/**
 * `GET /api/team`: only exists with `paprika serve --team`. `null` means "there is no team mode": a 404, or an answer that is
 * not JSON (the server falls back to the SPA shell). A JSON error (the sidecar answered, say 400 or 503) or a failure to
 * reach the server says nothing about team mode, so it is `undefined` ("not known yet": the team tab stays until the
 * socket brings a `team` message).
 */
export async function fetchTeamStatus(signal?: AbortSignal): Promise<Record<string, unknown> | null | undefined> {
  try {
    const response = await fetch("/api/team", { signal });
    if (response.status === 404 || !isJson(response)) return null;
    if (!response.ok) return undefined;
    const body: unknown = await response.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return undefined;
  }
}

export const workspacePath = (id: string) => `/api/workspaces/${encodeURIComponent(id)}`;
