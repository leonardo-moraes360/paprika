import { Plus } from "lucide-react";
import { useRef, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { AgentStack } from "@/components/ui/agent-stack";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { IconButton } from "@/components/ui/icon-button";
import { PageItem } from "@/components/ui/page-item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SectionHeader } from "@/components/ui/section-header";
import { Tooltip } from "@/components/ui/tooltip";
import { initialPagesPanelState, PagesPanelRegion } from "./store";
import type { PageEntry, PagesPanelProps } from "./types";

export function PagesPanel(props: PagesPanelProps) {
  return (
    <PagesPanelRegion.Provider initial={initialPagesPanelState}>
      <PagesPanelView {...props} />
    </PagesPanelRegion.Provider>
  );
}

function PagesPanelView({ pages, activePageId = null, onOpen, onCreate, onRename, onDelete, listMaxHeight = 104, className }: PagesPanelProps) {
  const { t } = useTranslation();
  const store = PagesPanelRegion.useRegionStore();
  const renamingId = PagesPanelRegion.useRegion((s) => s.renamingId);
  const deletingId = PagesPanelRegion.useRegion((s) => s.deletingId);
  const settled = useRef(false);

  const startRename = (id: string) => {
    settled.current = false;
    store.setState((s) => ({ ...s, renamingId: id }));
  };
  const finishRename = (page: PageEntry, value: string | null) => {
    if (settled.current) return;
    settled.current = true;
    store.setState((s) => ({ ...s, renamingId: null }));
    const name = value?.trim();
    if (name && name !== page.name) onRename(page.id, name);
  };
  const requestDelete = (page: PageEntry) => {
    if (page.hasContent) store.setState((s) => ({ ...s, deletingId: page.id }));
    else onDelete(page.id);
  };
  const onItemKeyDown = (event: KeyboardEvent<HTMLDivElement>, page: PageEntry) => {
    if (event.key !== "F2" || renamingId === page.id) return;
    event.preventDefault();
    startRename(page.id);
  };

  const deleting = pages.find((page) => page.id === deletingId);
  const canDelete = pages.length > 1;

  return (
    <div className={className}>
      <SectionHeader
        title={t("frontends.pagesPanel.title")}
        headingLevel={2}
        actions={
          <Tooltip content={t("frontends.pagesPanel.newPage")} side="bottom">
            <IconButton size="xs" aria-label={t("frontends.pagesPanel.newPage")} onClick={onCreate}>
              <Plus aria-hidden="true" />
            </IconButton>
          </Tooltip>
        }
      />
      <ScrollArea style={{ maxHeight: listMaxHeight }} viewportClassName="max-h-[inherit]">
        {pages.length === 0 ? (
          <p className="px-3 pb-2 text-sm text-muted">{t("frontends.pagesPanel.empty")}</p>
        ) : (
          <div role="list" aria-label={t("frontends.pagesPanel.pageList")} className="flex flex-col gap-0.5 pr-1 pb-2 pl-2">
            {pages.map((page) => (
              <PageItem
                key={page.id}
                role="listitem"
                name={page.name}
                active={page.id === activePageId}
                renaming={renamingId === page.id}
                renameLabel={t("frontends.pagesPanel.renamePage")}
                deleteLabel={t("frontends.pagesPanel.deletePage", { name: page.name })}
                agents={page.agents ? <AgentStack count={page.agents} label={t("frontends.pagesPanel.agentsOnPage", { count: page.agents })} /> : undefined}
                onSelect={() => onOpen(page.id)}
                onDoubleClick={() => startRename(page.id)}
                onKeyDown={(event) => onItemKeyDown(event, page)}
                onRename={(value) => finishRename(page, value)}
                onRenameCancel={() => finishRename(page, null)}
                onDelete={canDelete ? () => requestDelete(page) : undefined}
              />
            ))}
          </div>
        )}
      </ScrollArea>
      {deleting ? (
        <AlertDialog
          open
          onOpenChange={(open) => {
            if (!open) store.setState((s) => ({ ...s, deletingId: null }));
          }}
          pendingAnnouncement={t("common.working")}
          title={t("frontends.pagesPanel.deleteTitle", { name: deleting.name })}
          description={t("frontends.pagesPanel.deleteDescription")}
          confirmLabel={t("frontends.pagesPanel.deleteConfirm")}
          cancelLabel={t("frontends.pagesPanel.deleteCancel")}
          onConfirm={() => onDelete(deleting.id)}
        />
      ) : null}
    </div>
  );
}
