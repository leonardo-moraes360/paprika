import { useCallback, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ImportDialog, type ImportRequest, type ImportedFilePayload } from "@/components/frontends/import-dialog";
import { activePageId } from "@/adapters/export";
import { batchBySize, converterNote, fileKind, IMAGE_BYTES, IMAGE_DATA_URI_CHARS, IMPORT_BATCH_BYTES, imageNode, MarkupError, opsBytes, parseMarkup, placeNodes, refusalFor } from "@/adapters/import";
import type { NodeInput } from "@paprika/core";
import { isInterruptedError, isOfflineError, useLiveActions, useLiveClient } from "@/data/live";
import { showStatusToast } from "@/lib/notify";
import { useEditor, useEditorActions, useEditorStore } from "../editor-store";

/** What the dialog offers. A `.paprika.json` is not in the list: it is a whole document and is always refused (`refusalFor`), so offering it would only lead to an error. */
const accept = [".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".html", ".htm"];

/** The browser could not read the file (`FileReader` failed). */
class UnreadableFile extends Error {}

const readDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new UnreadableFile());
    reader.readAsDataURL(file);
  });

const naturalSize = (src: string) =>
  new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || 1, height: image.naturalHeight || 1 });
    image.onerror = () => reject(new Error("invalid image"));
    image.src = src;
  });

type Outcome = { name: string; group: NodeInput[]; warnings: string[] } | { error: string };

/** A converter note (English, from the core) in the language of the app; one the app does not know is shown as it came. */
function noteText(t: TFunction, text: string): string {
  const { key, values } = converterNote(text);
  // Each note has its own placeholders (the adapter fills exactly those); the typed keys cannot know which key comes out.
  return (t as (key: string, options: object) => string)(`app.collab.import.notes.${key}`, values);
}

/** Texts in a list of the language (“a, b and c”), not glued with a separator of ours. */
const listOf = (language: string, items: readonly string[]) => new Intl.ListFormat(language, { style: "long", type: "conjunction" }).format(items);

/** One line per item, as a list the toast can show. */
const asList = (items: readonly string[]): ReactNode => (
  <ul className="list-disc ps-4">
    {items.map((item, index) => (
      <li key={index}>{item}</li>
    ))}
  </ul>
);

/** One file to the nodes it makes, or the reason it cannot be placed (the old canvas's limits for pictures, `.fig`, PDF, and `.paprika.json` refused). */
async function convert(t: TFunction, language: string, entry: ImportedFilePayload): Promise<Outcome> {
  const { file } = entry;
  const name = file.name || "file";
  const refusal = refusalFor(name);
  if (refusal) return { error: t(`app.collab.import.${refusal.code}`, { name }) };
  try {
    const kind = fileKind(name, file.type, entry.text);
    if (kind === "raster") {
      if (file.size > IMAGE_BYTES) return { error: t("app.collab.import.tooLarge", { name, size: file.size, limit: IMAGE_BYTES }) };
      const src = await readDataUrl(file);
      if (src.length > IMAGE_DATA_URI_CHARS) return { error: t("app.collab.import.dataUri", { name, limit: IMAGE_DATA_URI_CHARS }) };
      const size = await naturalSize(src).catch(() => null);
      if (!size) return { error: t("app.collab.import.invalidImage", { name }) };
      return { name, group: [imageNode(file, src, size)], warnings: [] };
    }
    if (kind === "svg" || kind === "html") {
      const text = entry.text ?? (await file.text());
      const { nodes, warnings } = parseMarkup(kind === "html" && /^\s*<svg[\s>]/i.test(text) ? "svg" : kind, text);
      return { name, group: nodes, warnings };
    }
    return { error: t("app.collab.import.unsupported", { name }) };
  } catch (error) {
    if (error instanceof UnreadableFile) return { error: t("app.collab.import.unreadable", { name }) };
    if (error instanceof MarkupError) {
      return { error: error.notes.length === 0 ? t("app.collab.import.nothing", { name }) : t("app.collab.import.failed", { name, reason: listOf(language, error.notes.map((note) => noteText(t, note))) }) };
    }
    const reason = error instanceof Error ? error.message : String(error);
    if (reason === "empty") return { error: t("app.collab.import.nothing", { name }) };
    // A refusal of the converter that the app knows is said in its language; anything else is shown as it came.
    return { error: t("app.collab.import.failed", { name, reason: converterNote(reason).key === "other" ? reason : noteText(t, reason) }) };
  }
}

/** Made while it is open (like the export dialog): only the Files tab, because the server has no import route for the others. */
function ImportContainer() {
  const { t, i18n } = useTranslation();
  const client = useLiveClient();
  const editor = useEditorStore();
  const { apply } = useLiveActions();
  const { closeDialog, select } = useEditorActions();
  const [destination] = useState(() => {
    const doc = client.store.state.doc;
    const page = doc ? activePageId(doc, editor.state.pageId) : null;
    return (page ? doc?.nodes[page]?.name : "") || t("app.collab.import.noPage");
  });
  const onOpenChange = useCallback((next: boolean) => !next && closeDialog("import"), [closeDialog]);
  const onImport = useCallback(
    async (request: ImportRequest) => {
      if (request.source !== "files") return;
      const outcomes = await Promise.all(request.files.map((entry) => convert(t, i18n.language, entry)));
      const failures = outcomes.flatMap((outcome) => ("error" in outcome ? [outcome.error] : []));
      const done = outcomes.flatMap((outcome) => ("group" in outcome ? [outcome] : []));
      if (done.length === 0) {
        // The dialog shows one sentence; with several files the details go in a list the person can read beside it.
        if (failures.length > 1) showStatusToast({ status: "danger", title: t("app.collab.import.allFailed", { count: failures.length }), description: asList(failures) });
        throw new Error(failures.length === 1 ? failures[0] : t("app.collab.import.allFailed", { count: failures.length }));
      }
      const doc = client.store.state.doc;
      if (!doc) throw new Error(t("app.collab.import.offline"));
      const parentId = activePageId(doc, editor.state.pageId);
      const placed = placeNodes(doc, parentId, done.map((outcome) => outcome.group), done.flatMap((outcome) => outcome.warnings));

      // The server takes at most 8 MiB in a message and closes the socket over that: a batch of files per message, each one under the limit.
      const batches = batchBySize(placed.byGroup.map((group) => opsBytes(group.ops)));
      const imported: string[] = [];
      let importedFiles = 0;
      let lastError: unknown = null;
      let connectionLost = false;
      for (const batch of batches) {
        const files = batch.indexes.map((index) => done[index]!);
        if (connectionLost) {
          failures.push(...files.map((file) => t("app.collab.import.notSent", { name: file.name })));
          continue;
        }
        if (batch.oversized) {
          failures.push(t("app.collab.import.tooBigToSend", { name: files[0]!.name, limit: IMPORT_BATCH_BYTES / 1_000_000 }));
          continue;
        }
        try {
          await apply(
            batch.indexes.flatMap((index) => placed.byGroup[index]!.ops),
            t("app.collab.import.label", { count: files.length }),
          );
          imported.push(...batch.indexes.flatMap((index) => placed.byGroup[index]!.ids));
          importedFiles += files.length;
        } catch (error) {
          lastError = error;
          if (isInterruptedError(error)) {
            connectionLost = true;
            failures.push(...files.map((file) => t("app.collab.import.mayBeApplied", { name: file.name })));
          } else if (isOfflineError(error)) {
            connectionLost = true;
            failures.push(...files.map((file) => t("app.collab.import.notSent", { name: file.name })));
          } else {
            const reason = error instanceof Error ? error.message : String(error);
            failures.push(...files.map((file) => t("app.collab.import.failed", { name: file.name, reason })));
          }
        }
      }
      if (importedFiles === 0) {
        // Nothing went in: the dialog stays open with why (and the files, to try again).
        if (isInterruptedError(lastError)) throw new Error(t("app.collab.import.interrupted"));
        if (isOfflineError(lastError)) throw new Error(t("app.collab.import.offline"));
        if (failures.length > 1) showStatusToast({ status: "danger", title: t("app.collab.import.allFailed", { count: failures.length }), description: asList(failures) });
        throw new Error(failures.length === 1 ? failures[0] : lastError instanceof Error ? lastError.message : t("app.collab.import.allFailed", { count: failures.length }));
      }
      select(imported);
      if (failures.length > 0) {
        showStatusToast({ status: "warning", title: t("app.collab.import.partial", { done: importedFiles, total: request.files.length }), description: asList(failures) });
      } else if (placed.warnings.length > 0) {
        showStatusToast({ status: "warning", title: t("app.collab.import.warnings"), description: asList([...new Set(placed.warnings.map((warning) => noteText(t, warning)))]) });
      }
    },
    [apply, client, editor, i18n.language, select, t],
  );
  return <ImportDialog open onOpenChange={onOpenChange} destination={destination} tabs={["files"]} accept={accept} maxFileSize={IMAGE_BYTES} onImport={onImport} />;
}

export function Import() {
  const open = useEditor((s) => s.dialogs.import);
  return open ? <ImportContainer /> : null;
}
