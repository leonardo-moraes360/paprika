import { useTranslation } from "react-i18next";
import { toaster } from "@/lib/notify";
import { StatusToastRegion } from "./ui/toast";

/** `className` moves the region (the editor lifts it above the zoom bar); the default is 16 px above the window's edge. */
export function Notifications({ className = "mb-4" }: { className?: string } = {}) {
  const { t } = useTranslation();
  return <StatusToastRegion toaster={toaster} aria-label={t("notifications.label")} closeLabel={t("notifications.close")} pendingAnnouncement={t("common.working")} className={className} />;
}
