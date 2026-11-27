import type { Op } from "@paprika/core";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { INTERRUPTED_MESSAGE, isInterruptedError, isOfflineError, OFFLINE_MESSAGE, useLiveActions } from "@/data/live";
import { showStatusToast } from "@/lib/notify";
import { errorText } from "@/lib/use-async-action";

/** The message a failed action shows: the connection text when offline (and, when the request had already left, that it may have been applied), else the server's own words (or a generic line). */
export function useFailureText() {
  const { t } = useTranslation();
  return useCallback(
    (error: unknown) => {
      // A screen may hold only the text of the rejection (a panel's `onError(message)`): "interrupted" and "offline" are the messages of the two connection errors.
      const text = errorText(error);
      if (isInterruptedError(error) || text === INTERRUPTED_MESSAGE) return t("app.connection.interrupted");
      if (isOfflineError(error) || text === OFFLINE_MESSAGE) return t("app.connection.lost");
      return text.trim() || t("app.shell.actionFailed");
    },
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
