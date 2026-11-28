import { KeyRound } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { NoticeCard } from "@/components/ui/notice-card";
import { errorMessageOr, useAsyncAction, errorOrFallback } from "@/lib/use-async-action";
import type { TeamActions, TeamMemberEntry } from "./types";

export function RemoveMemberDialog({ member, onRemoveMember, onClose }: { member: TeamMemberEntry; onRemoveMember: TeamActions["onRemoveMember"]; onClose: () => void }) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      pendingAnnouncement={t("common.working")}
      title={t("frontends.team.removeTitle", { name: member.name })}
      description={t("frontends.team.removeBody", { name: member.name, fingerprint: member.fingerprint })}
      confirmLabel={t("frontends.team.removeConfirm", { name: member.name })}
      cancelLabel={t("frontends.team.cancel")}
      onConfirm={async () => {
        setError(null);
        try {
          await onRemoveMember(member.id);
        } catch (failure) {
          setError(errorMessageOr(failure, t("frontends.team.unknownError")));
          throw failure;
        }
      }}
    >
      <p className="m-0 text-sm text-muted">{t("frontends.team.removeNote")}</p>
      {error !== null ? (
        <p role="alert" className="m-0 text-sm font-medium text-red-ink">
          {t("frontends.team.failed", { message: error })}
        </p>
      ) : null}
    </AlertDialog>
  );
}

export function LeaveTeamDialog({ onLeave, onClose }: { onLeave: TeamActions["onLeave"]; onClose: () => void }) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      pendingAnnouncement={t("common.working")}
      title={t("frontends.team.leaveTitle")}
      description={t("frontends.team.leaveBody")}
      confirmLabel={t("frontends.team.leaveConfirm")}
      cancelLabel={t("frontends.team.cancel")}
      onConfirm={async () => {
        setError(null);
        try {
          await onLeave();
        } catch (failure) {
          setError(errorMessageOr(failure, t("frontends.team.unknownError")));
          throw failure;
        }
      }}
    >
      {error !== null ? (
        <p role="alert" className="m-0 text-sm font-medium text-red-ink">
          {t("frontends.team.failed", { message: error })}
        </p>
      ) : null}
    </AlertDialog>
  );
}

export function RotateKeyDialog({ fingerprint, onRotateKey, onClose }: { fingerprint: string; onRotateKey: TeamActions["onRotateKey"]; onClose: () => void }) {
  const { t } = useTranslation();
  const action = useAsyncAction();
  const [next, setNext] = useState<string | null>(null);
  const [before] = useState(fingerprint);
  const done = next !== null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      pendingAnnouncement={t("common.working")}
      closeLabel={t("frontends.team.close")}
      title={t("frontends.team.rotateTitle")}
      description={t("frontends.team.rotateLead")}
      className="w-130"
      footer={
        <>
          <Button variant="secondary" pendingAnnouncement="" onClick={onClose}>
            {done ? t("frontends.team.closeButton") : t("frontends.team.cancel")}
          </Button>
          {done ? null : (
            <Button
              pendingAnnouncement={t("common.working")}
              onClick={() =>
                action.run(async () => {
                  const result = await onRotateKey();
                  setNext(result ? result.fingerprint : "");
                })
              }
            >
              <KeyRound aria-hidden="true" />
              {action.pending ? t("frontends.team.rotating") : t("frontends.team.rotateConfirm")}
            </Button>
          )}
        </>
      }
    >
      <p className="m-0 text-sm text-muted">{done ? t("frontends.team.rotateOld", { fingerprint: before }) : t("frontends.team.rotateCurrent", { fingerprint: before })}</p>
      {done && next ? (
        <p role="status" className="m-0 text-sm font-medium text-green-ink">
          {t("frontends.team.rotateNew", { fingerprint: next })}
        </p>
      ) : null}
      {action.error !== null ? (
        <NoticeCard variant="band" status="danger" title={t("frontends.team.rotateFailed")} role="alert">
          {errorOrFallback(action.error, t("frontends.team.unknownError"))}
        </NoticeCard>
      ) : null}
    </Dialog>
  );
}
