import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { NoticeCard } from "@/components/ui/notice-card";
import { Spinner } from "@/components/ui/spinner";
import { useLive } from "@/data/live";
import { Editor } from "./editor";
import { ShellWarmup } from "./shell-warmup";
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

/** State while the workspace is being opened: the in-line strip of the design (`03-estados`, "Abrindo um workspace"), the same band the overview uses for its failures, in the neutral tone. */
export function OpeningWorkspace() {
  const { t } = useTranslation();
  const connected = useLive((s) => s.connected);
  return (
    <main className="min-h-dvh bg-bg px-10 py-7">
      <ShellWarmup />
      <NoticeCard
        variant="band"
        status="neutral"
        leading={<Spinner label={t("app.open.title")} className="size-4.5 border-[2.5px]" />}
        title={`${t("app.open.title")}…`}
        className="py-2.5 [&>div:first-of-type]:font-bold"
        actions={<span className="text-base font-normal text-muted">{connected ? t("app.open.description") : t("app.open.connecting")}</span>}
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
