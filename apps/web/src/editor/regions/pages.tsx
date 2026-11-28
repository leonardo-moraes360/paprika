import { newId, type NameLocale } from "@paprika/core";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { PagesPanel } from "@/components/frontends/pages-panel";
import { addPageOp, pageBases, samePages, toPageEntries } from "@/adapters/pages";
import { useLive, useLiveClient } from "@/data/live";
import { useEditorActions, useEditorStore } from "../editor-store";
import { useActiveAgents } from "../use-active-agents";
import { useActivePageId, useCorrectPage } from "../use-active-page";
import { useApplyOps } from "../use-apply";

/** Pages of the document: open, create, rename and delete by ops. The page in view lives in the editor store and is corrected when it disappears. */
export function Pages() {
  const { t, i18n } = useTranslation();
  const client = useLiveClient();
  const editor = useEditorActions();
  const store = useEditorStore();
  const apply = useApplyOps();
  const bases = useLive((s) => pageBases(s.doc), samePages);
  const byPage = useActiveAgents((a) => a.pages);
  const activePageId = useActivePageId();
  useCorrectPage();

  const pages = useMemo(() => toPageEntries(bases, byPage), [bases, byPage]);
  const locale = (i18n.resolvedLanguage === "pt-BR" ? "pt-BR" : "en") satisfies NameLocale;

  const onOpen = useCallback((id: string) => editor.setPage(id), [editor]);
  const onCreate = useCallback(() => {
    const doc = client.store.state.doc;
    if (!doc) return;
    const id = newId();
    editor.setPage(id);
    void apply([addPageOp(doc, id, locale)], t("app.shell.labels.createPage")).then((ok) => {
      if (!ok && store.state.pageId === id) editor.setPage(null);
    });
  }, [client, editor, store, apply, locale, t]);
  const onRename = useCallback((id: string, name: string) => void apply([{ op: "update", id, props: { name } }], t("app.shell.labels.renamePage")), [apply, t]);
  const onDelete = useCallback(
    (id: string) => {
      if (store.state.pageId === id) editor.setPage(null);
      void apply([{ op: "delete", id }], t("app.shell.labels.deletePage"));
    },
    [apply, editor, store, t],
  );

  return <PagesPanel pages={pages} activePageId={activePageId} onOpen={onOpen} onCreate={onCreate} onRename={onRename} onDelete={onDelete} storageKey="pages.open" />;
}
