import { Plus } from "lucide-react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { IconButton } from "@/components/ui/icon-button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SectionHeader } from "@/components/ui/section-header";
import { Tooltip } from "@/components/ui/tooltip";
import { booleanCodec } from "@/lib/persist";
import { usePersistedState } from "@/lib/use-persisted-state";
import { PageRow } from "./page-row";
import { initialPagesPanelState, PagesPanelRegion } from "./store";
import type { PageEntry, PagesPanelProps } from "./types";

export function PagesPanel(props: PagesPanelProps) {
  return (
    <PagesPanelRegion.Provider initial={initialPagesPanelState}>
      <PagesPanelView {...props} />
    </PagesPanelRegion.Provider>
  );
}

type PendingFocus = { removedId: string; targetId: string | null };

function PagesPanelView({
  pages,
  activePageId = null,
  onOpen,
  onCreate,
  onRename,
  onDelete,
  open,
  defaultOpen = true,
  onOpenChange,
  storageKey,
  listMaxHeight = 104,
  className,
}: PagesPanelProps) {
  const { t } = useTranslation();
  const store = PagesPanelRegion.useRegionStore();
  const actions = PagesPanelRegion.useRegionActions();
  const deletingId = PagesPanelRegion.useRegion((s) => s.deletingId);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const createButton = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<PendingFocus | null>(null);
  const [storedOpen, setStoredOpen] = usePersistedState(storageKey, defaultOpen, booleanCodec);
  const isOpen = open ?? storedOpen;

  const changeOpen = (next: boolean) => {
    if (open === undefined) setStoredOpen(next);
    onOpenChange?.(next);
  };

  const deletePage = (id: string) => {
    const index = pages.findIndex((page) => page.id === id);
    const neighbour = pages[index + 1] ?? pages[index - 1];
    pendingFocus.current = { removedId: id, targetId: neighbour?.id ?? null };
    onDelete(id);
  };
  const requestDelete = (page: PageEntry) => {
    if (page.hasContent) actions.askDelete(page.id);
    else deletePage(page.id);
  };

  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    if (!pending || deletingId !== null || pages.some((page) => page.id === pending.removedId)) return;
    pendingFocus.current = null;
    const neighbour = pending.targetId === null ? undefined : buttons.current.get(pending.targetId);
    (neighbour ?? createButton.current)?.focus();
  }, [pages, deletingId]);

  useEffect(() => {
    const renamingId = store.get().renamingId;
    if (renamingId !== null && !pages.some((page) => page.id === renamingId)) actions.stopRename();
  }, [pages, store, actions]);

  const deleting = pages.find((page) => page.id === deletingId);
  const canDelete = pages.length > 1;

  return (
    <SectionHeader
      className={className}
      title={t("frontends.pagesPanel.title")}
      headingLevel={2}
      open={isOpen}
      onOpenChange={changeOpen}
      actions={
        <Tooltip content={t("frontends.pagesPanel.newPage")} side="bottom">
          <IconButton ref={createButton} size="xs" aria-label={t("frontends.pagesPanel.newPage")} onClick={onCreate}>
            <Plus aria-hidden="true" />
          </IconButton>
        </Tooltip>
      }
    >
      <ScrollArea style={{ maxHeight: listMaxHeight }} viewportClassName="max-h-[inherit]">
        {pages.length === 0 ? (
          <p className="px-3 pb-2 text-sm text-muted">{t("frontends.pagesPanel.empty")}</p>
        ) : (
          <div role="list" aria-label={t("frontends.pagesPanel.pageList")} className="flex flex-col gap-0.5 pe-1 pb-2 ps-2">
            {pages.map((page) => (
              <PageRow
                key={page.id}
                page={page}
                active={page.id === activePageId}
                canDelete={canDelete}
                buttons={buttons}
                onOpen={onOpen}
                onRename={onRename}
                onRequestDelete={requestDelete}
              />
            ))}
          </div>
        )}
      </ScrollArea>
      {deleting ? (
        <AlertDialog
          open
          onOpenChange={(next) => {
            if (!next) actions.cancelDelete();
          }}
          pendingAnnouncement={t("common.working")}
          title={t("frontends.pagesPanel.deleteTitle", { name: deleting.name })}
          description={t("frontends.pagesPanel.deleteDescription")}
          confirmLabel={t("frontends.pagesPanel.deleteConfirm")}
          cancelLabel={t("frontends.pagesPanel.deleteCancel")}
          onConfirm={() => deletePage(deleting.id)}
        />
      ) : null}
    </SectionHeader>
  );
}
