import { useTranslation } from "react-i18next";
import { toaster } from "@/lib/notify";
import { StatusToastRegion } from "./ui/toast";

export function Notifications() {
  const { t } = useTranslation();
  return <StatusToastRegion toaster={toaster} aria-label={t("notifications.label")} closeLabel={t("notifications.close")} pendingAnnouncement={t("common.working")} className="mb-4" />;
}
