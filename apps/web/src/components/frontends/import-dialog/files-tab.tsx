import { formatFileSize } from "@ui-sdk/react/file-input";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/ui/icon-button";
import { ImportDropzone } from "@/components/ui/import-dropzone";
import { ImportedFile } from "@/components/ui/imported-file";
import { fileKind } from "./read-file";

export type FileEntry = {
  key: string;
  file: File;
  status: "reading" | "done" | "error";
  progress?: number;
  reason?: string;
  rejected?: boolean;
};

export type FilesTabProps = {
  destination: string;
  accept: readonly string[];
  maxFileSize?: number;
  entries: readonly FileEntry[];
  onAdd: (accepted: File[]) => void;
  onReject: (rejected: { file: File; reasons: string[] }[]) => void;
  onRemove: (key: string) => void;
};

export function FilesTab({ destination, accept, maxFileSize, entries, onAdd, onReject, onRemove }: FilesTabProps) {
  const { t, i18n } = useTranslation();
  const accepted = entries.filter((entry) => !entry.rejected).map((entry) => entry.file);
  return (
    <div className="flex flex-col gap-3">
      <ImportDropzone
        multiple
        accept={accept}
        maxSize={maxFileSize}
        value={accepted}
        onValueChange={(_, details) => {
          if (details.added.length > 0) onAdd(details.added);
        }}
        onReject={(rejected) => onReject(rejected)}
        announcement={(change) =>
          [
            change.added.length > 0 ? t("frontends.importDialog.files.announcement_added", { count: change.added.length }) : "",
            change.rejected.length > 0 ? t("frontends.importDialog.files.announcement_rejected", { count: change.rejected.length }) : "",
          ]
            .filter(Boolean)
            .join(" ") || null
        }
        prompt={t("frontends.importDialog.files.prompt", { name: destination })}
        draggingPrompt={t("frontends.importDialog.files.dragging", { name: destination })}
        errorPrompt={t("frontends.importDialog.files.rejected")}
        formats={accept.join(", ")}
        browseLabel={t("frontends.importDialog.files.browse")}
        className="w-full"
      />
      {entries.length > 0 ? (
        <ul aria-label={t("frontends.importDialog.files.list")} className="flex flex-col gap-1.5">
          {entries.map((entry) => {
            const size = formatFileSize(entry.file.size, i18n.language);
            const kind = fileKind(entry.file);
            return (
              <li key={entry.key} className="flex items-center gap-1">
                <ImportedFile
                  className="w-auto min-w-0 flex-1"
                  status={entry.status === "reading" ? "uploading" : entry.status}
                  name={entry.file.name}
                  detail={entry.status === "error" ? entry.reason : kind ? `${kind} · ${size}` : size}
                  progress={entry.progress === undefined ? undefined : Math.round(entry.progress * 100)}
                  statusLabel={t(`frontends.importDialog.files.${entry.status === "reading" ? "reading" : entry.status === "done" ? "ready" : "failed"}`)}
                />
                <IconButton size="sm" aria-label={t("frontends.importDialog.files.remove", { name: entry.file.name })} onClick={() => onRemove(entry.key)}>
                  <X aria-hidden="true" />
                </IconButton>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
