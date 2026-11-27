import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Overview } from "@/components/frontends/overview";
import { toProjectEntries, toWorkspaceEntries } from "@/adapters/workspaces";
import { errorText } from "@/data/api";
import { openWorkspace, useWorkspaces } from "@/data/queries/workspaces";
import { showStatusToast } from "@/lib/notify";

const notYet = () => Promise.reject(new Error("Not wired yet"));

/**
 * `/`: the workspaces the server lists, and opening one. Skeleton of batch 1: create, rename, delete, archive,
 * cover and projects are still the placeholders below (they reject, so the frontend shows its own error).
 */
export function OverviewContainer() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const query = useWorkspaces();
  const workspaces = useMemo(() => toWorkspaceEntries(query.data?.workspaces ?? []), [query.data]);
  const projects = useMemo(() => toProjectEntries(query.data?.folders ?? []), [query.data]);
  const { refetch } = query;
  const onRetry = useCallback(() => void refetch(), [refetch]);
  const onOpen = useCallback(
    (id: string) => {
      void navigate({ to: "/w/$workspaceId", params: { workspaceId: id } });
      openWorkspace(id).catch((error: unknown) => {
        showStatusToast({ status: "danger", title: t("app.overview.openFailed"), description: errorText(error) });
      });
    },
    [navigate, t],
  );
  return (
    <div className="h-dvh">
      <Overview
      workspaces={workspaces}
      projects={projects}
      loading={query.isPending}
      error={query.isError ? errorText(query.error) || t("app.overview.loadFailed") : null}
      onRetry={onRetry}
      onOpen={onOpen}
      onCreate={notYet}
      onRename={notYet}
      onDelete={notYet}
      onArchive={notYet}
      onRestore={notYet}
      onChangeCover={notYet}
      onMoveToProject={notYet}
    />
    </div>
  );
}
