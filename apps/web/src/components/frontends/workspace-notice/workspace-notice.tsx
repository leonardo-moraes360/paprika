import { useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toneDot } from "@/components/ui/agent-tone";
import { Button } from "@/components/ui/button";
import { NoticeCard } from "@/components/ui/notice-card";
import { cn } from "@/lib/utils";
import type { WorkspaceNoticeCounts, WorkspaceNoticeProps } from "./types";

const keys = ["nodes", "pages", "frames", "images", "connectors", "historyEntries"] as const;

export function summarizeCounts(counts: WorkspaceNoticeCounts | undefined, format: (key: (typeof keys)[number], count: number) => string): string {
  return keys.flatMap((key) => ((counts?.[key] ?? 0) > 0 ? [format(key, counts?.[key] as number)] : [])).join(" · ");
}

export function WorkspaceNotice({ notice, onDismiss, onViewWorkspaces, className }: WorkspaceNoticeProps) {
  const { t } = useTranslation();
  const opener = useRef<Element | null>(null);
  const restore = useRef(false);
  const noticeId = notice?.id ?? null;
  useLayoutEffect(() => {
    if (noticeId !== null) {
      opener.current = opener.current ?? document.activeElement;
      return;
    }
    if (restore.current && opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus();
    restore.current = false;
    opener.current = null;
  }, [noticeId]);
  const leave = (action: () => void) => () => {
    restore.current = true;
    action();
  };
  const summary = notice?.op === "delete" ? summarizeCounts(notice.counts, (key, count) => t(`frontends.workspaceNotice.count.${key}`, { count })) : "";
  return (
    <div aria-live="polite" className={cn("pointer-events-none fixed end-4 bottom-4 z-40 w-85 max-w-[calc(100%-2rem)]", className)}>
      {notice ? (
        <NoticeCard
          key={notice.id}
          role="status"
          className="pointer-events-auto"
          leading={<span aria-hidden="true" className={cn("mt-1 size-2.5 shrink-0 rounded-full forced-colors:border forced-colors:border-[CanvasText]", toneDot[notice.actor.tone ?? "agent-1"])} />}
          title={
            <>
              <strong>{notice.actor.name}</strong> {t(`frontends.workspaceNotice.op.${notice.op}`, { name: notice.workspaceName })}
            </>
          }
          closeLabel={t("frontends.workspaceNotice.dismiss")}
          onClose={leave(onDismiss)}
          actions={
            onViewWorkspaces ? (
              <Button variant="secondary" size="sm" className="h-7.5" pendingAnnouncement="" onClick={leave(onViewWorkspaces)}>
                {t("frontends.workspaceNotice.view")}
              </Button>
            ) : undefined
          }
        >
          {summary || null}
        </NoticeCard>
      ) : null}
    </div>
  );
}
