import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { isOfflineError, useLiveClient, useLiveEvent } from "@/data/live";
import { errorText } from "@/data/api";
import { showStatusToast } from "@/lib/notify";

/**
 * Asks the server for the workspace in the URL and sends the user back to the overview when it cannot be shown:
 * the `view` is refused, or the workspace in view is deleted (by anyone). Losing the connection is not a reason to leave:
 * the pending `view` is sent again when the socket is back.
 */
export function useWorkspaceView(id: string) {
  const client = useLiveClient();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const latest = useRef({ t, navigate });
  latest.current = { t, navigate };
  useEffect(() => {
    let active = true;
    client.view(id).catch((error: unknown) => {
      if (!active || isOfflineError(error)) return;
      const { t, navigate } = latest.current;
      showStatusToast({ status: "danger", title: t("app.open.failedTitle"), description: errorText(error) || t("app.open.failedFallback") });
      void navigate({ to: "/", replace: true });
    });
    return () => {
      active = false;
    };
  }, [client, id]);
  useLiveEvent((event) => {
    if (event.type !== "workspaceOp" || event.op.op !== "delete" || event.op.workspaceId !== id) return;
    const { t, navigate } = latest.current;
    showStatusToast({ status: "warning", title: t("app.open.deleted") });
    void navigate({ to: "/", replace: true });
  });
}
