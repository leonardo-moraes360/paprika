import { Link } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { NoticeCard } from "@/components/ui/notice-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import type { ImportSource } from "./types";

export type SourceTabProps = {
  source: ImportSource | undefined;
  selected: ReadonlySet<string>;
  onToggle: (id: string, checked: boolean) => void;
  onRetry?: () => void;
};

export function SourceTab({ source, selected, onToggle, onRetry }: SourceTabProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5 rounded-lg bg-surface px-3 py-2.5">
        <Link aria-hidden="true" className="size-4 shrink-0 text-muted" />
        <p className="text-sm leading-normal text-fg">{t("frontends.importDialog.source.origin")}</p>
      </div>
      <p className="px-2.5 text-xs font-bold tracking-[0.8px] text-muted uppercase">{t("frontends.importDialog.source.group")}</p>
      {source?.error ? (
        <NoticeCard
          variant="band"
          status="danger"
          role="alert"
          title={source.error}
          actions={
            onRetry ? (
              <Button size="sm" variant="secondary" onClick={onRetry}>
                {t("frontends.importDialog.source.retry")}
              </Button>
            ) : undefined
          }
        />
      ) : source?.loading || !source ? (
        <div role="status" aria-label={t("frontends.importDialog.source.loading")} className="flex flex-col gap-2">
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
        </div>
      ) : source.items.length === 0 ? (
        <p className="px-2.5 text-sm text-muted">{t("frontends.importDialog.source.empty")}</p>
      ) : (
        <ul aria-label={t("frontends.importDialog.source.listLabel")} className="flex flex-col gap-0.5">
          {source.items.map((item) => (
            <li key={item.id} className="rounded-sm px-2 py-1.5 hover:bg-surface">
              <Checkbox
                labelClassName="w-full"
                checked={selected.has(item.id)}
                onCheckedChange={(next) => onToggle(item.id, next === true)}
                label={
                  <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                    <span className="truncate">{item.name}</span>
                    {item.detail ? <span className="shrink-0 text-sm text-muted">{item.detail}</span> : null}
                  </span>
                }
              />
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <Tag>{t("frontends.importDialog.source.soon")}</Tag>
        <p className="text-sm text-muted">{t("frontends.importDialog.source.federation")}</p>
      </div>
    </div>
  );
}
