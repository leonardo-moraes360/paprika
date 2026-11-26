import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { TextField } from "@/components/ui/text-field";
import type { WorkspaceEntry } from "./types";

export type DeleteDialogProps = {
  workspace: WorkspaceEntry;
  requireName: boolean;
  finalFocus?: () => HTMLElement | null;
  onCancel: () => void;
  onConfirm: (id: string) => unknown;
};

export function DeleteDialog({ workspace, requireName, finalFocus, onCancel, onConfirm }: DeleteDialogProps) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState("");
  const matches = !requireName || typed === workspace.name;
  return (
    <AlertDialog
      open
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      pendingAnnouncement={t("common.working")}
      title={t("frontends.overview.delete.title", { name: workspace.name })}
      description={t("frontends.overview.delete.description", { count: workspace.nodes })}
      confirmLabel={t("frontends.overview.delete.confirm")}
      confirmDisabled={!matches}
      cancelLabel={t("frontends.overview.delete.cancel")}
      onConfirm={() => onConfirm(workspace.id)}
      contentProps={{ ...(finalFocus ? { finalFocus } : {}), ...(requireName ? { initialFocus: "input" } : {}) }}
    >
      {requireName ? (
        <TextField
          label={t("frontends.overview.delete.typeLabel", { name: workspace.name })}
          value={typed}
          onValueChange={setTyped}
          autoComplete="off"
          spellCheck={false}
        />
      ) : null}
    </AlertDialog>
  );
}
