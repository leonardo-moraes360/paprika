import { useCallback, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CanvasError, type CanvasErrorIssue } from "@/components/frontends/canvas-error";
import { useLive } from "@/data/live";
import { useEditor } from "../editor-store";

/** Where "Report on GitHub" opens the issue (`repository` in the root `package.json`). */
export const issueTarget: CanvasErrorIssue = { repository: "leonardo-moraes360/paprika", labels: ["bug"] };

/**
 * Around the whole editor: an error while drawing it shows the frontend's recovery screen instead of a blank page.
 * `resetKey` is the workspace, so opening another one starts clean; "Reload" reloads the page, which asks the server for the document again.
 */
export function EditorBoundary({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const workspaceId = useLive((s) => s.doc?.id ?? "");
  const renderer = useEditor((s) => s.renderer);
  const onReload = useCallback(() => window.location.reload(), []);
  const environment = t("app.collab.boundary.environment", { renderer, agent: typeof navigator === "undefined" ? "" : navigator.userAgent });
  return (
    <CanvasError onReload={onReload} issue={issueTarget} environment={environment} resetKey={workspaceId}>
      {children}
    </CanvasError>
  );
}
