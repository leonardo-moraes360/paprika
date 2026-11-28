import { useCallback, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CanvasError, type CanvasErrorIssue } from "@/components/frontends/canvas-error";
import { useLive } from "@/data/live";
import { useEditor } from "../editor-store";

/** Where "Report on GitHub" opens the issue (`repository` in the root `package.json`). */
export const issueTarget: CanvasErrorIssue = { repository: "leonardo-moraes360/paprika", labels: ["bug"] };

/** "Chrome 142 · Linux" from a user-agent string; the raw string is a line of 150 characters. Unknown pieces are left out. */
export function summarizeAgent(userAgent: string): string {
  const browser =
    /Edg\/(\d+)/.exec(userAgent)?.[0].replace("Edg/", "Edge ") ??
    /Firefox\/(\d+)/.exec(userAgent)?.[0].replace("/", " ") ??
    /(?:Chrome|Chromium)\/(\d+)/.exec(userAgent)?.[1]?.replace(/^/, "Chrome ") ??
    (/Version\/(\d+).*Safari/.exec(userAgent)?.[1] ? `Safari ${/Version\/(\d+)/.exec(userAgent)?.[1]}` : "");
  const system = /Android/.test(userAgent) ? "Android" : /iPhone|iPad/.test(userAgent) ? "iOS" : /Windows/.test(userAgent) ? "Windows" : /Mac OS X/.test(userAgent) ? "macOS" : /Linux/.test(userAgent) ? "Linux" : "";
  return [browser, system].filter(Boolean).join(" · ");
}

/**
 * Around the whole editor: an error while drawing it shows the frontend's recovery screen instead of a blank page.
 * `resetKey` is the workspace, so opening another one starts clean; "Reload" reloads the page, which asks the server for the document again.
 */
export function EditorBoundary({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const workspaceId = useLive((s) => s.doc?.id ?? "");
  const renderer = useEditor((s) => s.renderer);
  const onReload = useCallback(() => window.location.reload(), []);
  const environment = t("app.collab.boundary.environment", { renderer, agent: typeof navigator === "undefined" ? "" : summarizeAgent(navigator.userAgent) });
  return (
    <CanvasError className="min-h-dvh" onReload={onReload} issue={issueTarget} environment={environment} resetKey={workspaceId}>
      {children}
    </CanvasError>
  );
}
