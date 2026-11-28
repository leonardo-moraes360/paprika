import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { isOfflineError, useLiveClient, useLiveEvent } from "@/data/live";
import { showOpenFailure } from "@/overview/open-failure";
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
      showOpenFailure(t, error);
      void navigate({ to: "/", replace: true });
    });
    return () => {
      active = false;
    };
  }, [client, id]);
  useLiveEvent((event) => {
    if (event.type !== "workspaceOp" || event.op.op !== "delete" || event.op.workspaceId !== id) return;
    const op = event.op;
    const { t, navigate } = latest.current;
    // An agent's deletion already raises the workspace notice (it names who did it and what went), which the overview shows: one warning, not two.
    if (!op.actor.startsWith("agent")) showStatusToast({ status: "warning", title: t("app.open.deleted") });
    void navigate({ to: "/", replace: true });
  });
}
