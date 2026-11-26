import { useCallback, useLayoutEffect, useRef, type KeyboardEvent, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { AgentStack } from "@/components/ui/agent-stack";
import { PageItem } from "@/components/ui/page-item";
import { PagesPanelRegion } from "./store";
import type { PageEntry } from "./types";

export type PageRowProps = {
  page: PageEntry;
  active: boolean;
  canDelete: boolean;
  buttons: RefObject<Map<string, HTMLButtonElement>>;
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onRequestDelete: (page: PageEntry) => void;
};

export function PageRow({ page, active, canDelete, buttons, onOpen, onRename, onRequestDelete }: PageRowProps) {
  const { t } = useTranslation();
  const actions = PagesPanelRegion.useRegionActions();
  const renaming = PagesPanelRegion.useRegion((s) => s.renamingId === page.id);
  const row = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  const settled = useRef(false);
  const returnFocus = useRef(false);

  const selectRef = useCallback(
    (element: HTMLButtonElement | null) => {
      button.current = element;
      if (element) buttons.current.set(page.id, element);
      else buttons.current.delete(page.id);
    },
    [buttons, page.id],
  );

  useLayoutEffect(() => {
    if (renaming || !returnFocus.current) return;
    returnFocus.current = false;
    button.current?.focus();
  }, [renaming]);

  const startRename = () => {
    settled.current = false;
    actions.startRename(page.id);
  };

  const finishRename = (value: string | null) => {
    if (settled.current) return;
    settled.current = true;
    returnFocus.current = row.current?.contains(document.activeElement) ?? false;
    actions.stopRename();
    const name = value?.trim();
    if (name && name !== page.name) onRename(page.id, name);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "F2" || renaming) return;
    event.preventDefault();
    startRename();
  };

  return (
    <PageItem
      ref={row}
      selectRef={selectRef}
      role="listitem"
      name={page.name}
      active={active}
      renaming={renaming}
      renameLabel={t("frontends.pagesPanel.renamePage")}
      deleteLabel={t("frontends.pagesPanel.deletePage", { name: page.name })}
      agents={page.agents ? <AgentStack count={page.agents} label={t("frontends.pagesPanel.agentsOnPage", { count: page.agents })} /> : undefined}
      onSelect={() => onOpen(page.id)}
      onDoubleClick={startRename}
      onKeyDown={onKeyDown}
      onRename={finishRename}
      onRenameCancel={() => finishRename(null)}
      onDelete={canDelete ? () => onRequestDelete(page) : undefined}
    />
  );
}
