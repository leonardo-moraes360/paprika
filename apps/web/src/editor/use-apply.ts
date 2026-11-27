import type { Op } from "@paprika/core";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { isInterruptedError, isOfflineError, useLiveActions } from "@/data/live";
import { showStatusToast } from "@/lib/notify";
import { errorText } from "@/lib/use-async-action";

/** The message a failed action shows: the connection text when offline (and, when the request had already left, that it may have been applied), else the server's own words (or a generic line). */
export function useFailureText() {
  const { t } = useTranslation();
  return useCallback(
    (error: unknown) => (isInterruptedError(error) ? t("app.connection.interrupted") : isOfflineError(error) ? t("app.connection.lost") : errorText(error).trim() || t("app.shell.actionFailed")),
    [t],
  );
}

/**
 * `apply(ops, label)` for the editor's regions: resolves `true` once the server acked, and when it did not (offline or
 * refused) tells the person with a toast and resolves `false`, so a caller only decides what to do on success.
 */
export function useApplyOps() {
  const { apply } = useLiveActions();
  const { t } = useTranslation();
  const failure = useFailureText();
  return useCallback(
    async (ops: Op[], label: string): Promise<boolean> => {
      try {
        await apply(ops, label);
        return true;
      } catch (error) {
        showStatusToast({ status: "danger", title: t("app.shell.actionFailedTitle"), description: failure(error) });
        return false;
      }
    },
    [apply, t, failure],
  );
}
