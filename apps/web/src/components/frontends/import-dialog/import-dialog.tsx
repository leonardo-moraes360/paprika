import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { errorMessageOr } from "@/lib/use-async-action";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import { formatFileSize } from "@ui-sdk/react/file-input";
import { FilesTab, type FileEntry } from "./files-tab";
import { isTextFile, readText } from "./read-file";
import { SourceTab } from "./source-tab";
import type { ImportDialogProps, ImportSourceTab, ImportTab } from "./types";

const defaultTabs: readonly ImportTab[] = ["files", "libraries", "workspaces", "projects"];
const defaultAccept = [".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".html", ".htm", ".paprika.json"];

type Read = { text?: string; failed?: boolean };

export function ImportDialog({
  open,
  onOpenChange,
  destination,
  tab: controlledTab,
  defaultTab = "files",
  onTabChange,
  tabs = defaultTabs,
  accept = defaultAccept,
  maxFileSize,
  sources = {},
  onImport,
  onRetrySource,
}: ImportDialogProps) {
  const { t, i18n } = useTranslation();
  const [innerTab, setInnerTab] = useState<ImportTab>(defaultTab);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [selection, setSelection] = useState<Record<ImportSourceTab, ReadonlySet<string>>>({
    libraries: new Set(),
    workspaces: new Set(),
    projects: new Set(),
  });
  const [failure, setFailure] = useState<string | null>(null);
  const reads = useRef(new Map<string, Read>());
  const controllers = useRef(new Map<string, AbortController>());
  const counter = useRef(0);
  const tab = controlledTab ?? innerTab;

  useEffect(() => {
    if (open) return;
    setEntries([]);
    setSelection({ libraries: new Set(), workspaces: new Set(), projects: new Set() });
    setFailure(null);
    for (const controller of controllers.current.values()) controller.abort();
    controllers.current.clear();
    reads.current.clear();
  }, [open]);

  useEffect(() => {
    const active = controllers.current;
    return () => {
      for (const controller of active.values()) controller.abort();
    };
  }, []);

  const patch = (key: string, change: Partial<FileEntry>) =>
    setEntries((current) => current.map((entry) => (entry.key === key ? { ...entry, ...change } : entry)));

  const add = (files: File[]) => {
    const created = files.map((file) => ({ key: `f${counter.current++}`, file, status: isTextFile(file) ? ("reading" as const) : ("done" as const) }));
    setEntries((current) => [...current, ...created]);
    for (const entry of created) {
      if (entry.status !== "reading") continue;
      const controller = new AbortController();
      controllers.current.set(entry.key, controller);
      readText(entry.file, (ratio) => patch(entry.key, { progress: ratio }), controller.signal)
        .then((text) => {
          if (controller.signal.aborted) return;
          controllers.current.delete(entry.key);
          reads.current.set(entry.key, { text });
          patch(entry.key, { status: "done", progress: undefined });
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          controllers.current.delete(entry.key);
          reads.current.set(entry.key, { failed: true });
          patch(entry.key, { status: "error", progress: undefined, reason: t("frontends.importDialog.files.readFail") });
        });
    }
  };

  const reject = (rejected: { file: File; reasons: string[] }[]) => {
    const created: FileEntry[] = rejected.map(({ file, reasons }) => ({
      key: `f${counter.current++}`,
      file,
      status: "error",
      rejected: true,
      reason: reasons.includes("file-type")
        ? t("frontends.importDialog.files.unsupported")
        : reasons.includes("file-too-large")
          ? t("frontends.importDialog.files.tooLarge", { size: formatFileSize(maxFileSize ?? 0, i18n.language) })
          : t("frontends.importDialog.files.other"),
    }));
    setEntries((current) => [...current, ...created]);
  };

  const remove = (key: string) => {
    controllers.current.get(key)?.abort();
    controllers.current.delete(key);
    reads.current.delete(key);
    setEntries((current) => current.filter((entry) => entry.key !== key));
  };

  const ready = entries.filter((entry) => entry.status === "done");
  const busy = entries.some((entry) => entry.status === "reading");
  const sourceTab = tab === "files" ? null : tab;
  const picked = sourceTab ? selection[sourceTab] : null;

  const changeTab = (next: ImportTab | null) => {
    if (!next) return;
    if (controlledTab === undefined) setInnerTab(next);
    if (next !== tab) onTabChange?.(next);
  };

  const submit = async () => {
    try {
      if (sourceTab) {
        const present = new Set((sources[sourceTab]?.items ?? []).map((item) => item.id));
        await onImport({ source: sourceTab, ids: [...(picked ?? [])].filter((id) => present.has(id)) });
      }
      else await onImport({ source: "files", files: ready.map((entry) => ({ file: entry.file, text: reads.current.get(entry.key)?.text })) });
      setFailure(null);
      onOpenChange(false);
    } catch (reason) {
      setFailure(t("frontends.importDialog.actions.failed", { reason: errorMessageOr(reason, t("frontends.importDialog.unknownError")) }));
    }
  };

  const pickedCount = sourceTab && picked ? [...picked].filter((id) => sources[sourceTab]?.items.some((item) => item.id === id)).length : 0;
  const canSubmit = sourceTab ? pickedCount > 0 : ready.length > 0 && !busy;
  const submitLabel = sourceTab
    ? pickedCount > 0
      ? t(`frontends.importDialog.actions.${sourceTab}`, { count: pickedCount })
      : t("frontends.importDialog.actions.importAction")
    : t("frontends.importDialog.actions.placeOnCanvas");

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      pendingAnnouncement={t("common.working")}
      title={t("frontends.importDialog.title", { name: destination })}
      closeLabel={t("frontends.importDialog.close")}
      className="w-155"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("frontends.importDialog.actions.cancel")}
          </Button>
          <Button disabled={!canSubmit} pendingAnnouncement={t("common.working")} onClick={submit}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <Tabs value={tab} onValueChange={changeTab}>
        <TabsList aria-label={t("frontends.importDialog.tabList")}>
          {tabs.map((value) => (
            <TabsTab key={value} value={value}>
              {t(`frontends.importDialog.tabs.${value}`)}
            </TabsTab>
          ))}
        </TabsList>
        {tabs.map((value) => (
          <TabsPanel key={value} value={value} className="mt-3">
            {value === "files" ? (
              <FilesTab destination={destination} accept={accept} maxFileSize={maxFileSize} entries={entries} onAdd={add} onReject={reject} onRemove={remove} />
            ) : (
              <SourceTab
                source={sources[value]}
                selected={selection[value]}
                onToggle={(id, checked) =>
                  setSelection((current) => {
                    const next = new Set(current[value]);
                    if (checked) next.add(id);
                    else next.delete(id);
                    return { ...current, [value]: next };
                  })
                }
                onRetry={onRetrySource ? () => onRetrySource(value) : undefined}
              />
            )}
          </TabsPanel>
        ))}
      </Tabs>
      {failure ? <ErrorBanner>{failure}</ErrorBanner> : null}
    </Dialog>
  );
}
