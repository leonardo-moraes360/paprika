import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { useLive } from "@/data/live";
import { Editor } from "./editor";
import { useWorkspaceView } from "./use-workspace-view";

/** Keeps `document.title` at the document's name; a leaf, so a rename re-renders only this. */
function DocumentTitle() {
  const name = useLive((s) => s.doc?.name ?? "");
  useEffect(() => {
    document.title = name ? `${name} · Paprika` : "Paprika";
    return () => {
      document.title = "Paprika";
    };
  }, [name]);
  return null;
}

/** State while the workspace is being opened (no design yet: closest component of the guide, reported to the owner). */
export function OpeningWorkspace() {
  const { t } = useTranslation();
  const connected = useLive((s) => s.connected);
  return (
    <main className="grid min-h-dvh place-items-center bg-bg p-4">
      <EmptyState
        illustration={<Spinner label={t("app.open.title")} className="size-6" />}
        title={t("app.open.title")}
        description={connected ? t("app.open.description") : t("app.offline")}
      />
    </main>
  );
}

/** `/w/$workspaceId`: opens the view, shows the opening state until the document in hand is that workspace, then the editor. */
export function WorkspaceRoute({ id }: { id: string }) {
  useWorkspaceView(id);
  const ready = useLive((s) => s.doc?.id === id);
  if (!ready) return <OpeningWorkspace />;
  return (
    <>
      <DocumentTitle />
      <Editor key={id} />
    </>
  );
}
