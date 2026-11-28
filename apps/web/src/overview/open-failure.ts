import type { TFunction } from "i18next";
import { openFailureOf } from "@/adapters/workspaces";
import { errorText } from "@/data/api";
import { showStatusToast } from "@/lib/notify";

/**
 * The one warning of a workspace that would not open. The overview (the `POST /open` it sends) and the editor route (the
 * socket's `view`) can both fail for the same click: they share the toast id, so the person sees one warning, not one per
 * request. A workspace that does not exist or is invalid gets the app's own sentence; the server's text (ids, validator JSON)
 * only goes to the console.
 */
export function showOpenFailure(t: TFunction, error: unknown) {
  const kind = openFailureOf(error);
  if (kind) console.warn("[paprika] could not open the workspace:", errorText(error));
  showStatusToast({
    id: "workspace-open-failed",
    status: "danger",
    title: t("app.open.failedTitle"),
    description: kind ? t(`app.open.${kind}`) : errorText(error) || t("app.open.failedFallback"),
  });
}
