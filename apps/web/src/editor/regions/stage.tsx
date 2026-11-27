import { useTranslation } from "react-i18next";
import { useLive } from "@/data/live";

/**
 * Skeleton: an empty stage that takes focus (the canvas does not exist yet). Batch 2 adds the toolbar and the
 * zoom bar over it. It must keep selecting narrow slices: a delta that changes one node never re-renders it.
 */
export function Stage() {
  const { t } = useTranslation();
  const id = useLive((s) => s.doc?.id ?? "");
  return <div tabIndex={0} role="region" aria-label={t("app.stage")} data-workspace={id} className="relative h-full min-h-0 flex-1 bg-bg outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-select" />;
}
