import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ImportDialog, type ImportRequest, type ImportedFilePayload } from "@/components/frontends/import-dialog";
import { activePageId } from "@/adapters/export";
import { fileKind, IMAGE_BYTES, IMAGE_DATA_URI_CHARS, imageNode, parseMarkup, placeNodes, refusalFor } from "@/adapters/import";
import type { NodeInput } from "@paprika/core";
import { isOfflineError, useLiveActions, useLiveClient } from "@/data/live";
import { showStatusToast } from "@/lib/notify";
import { useEditor, useEditorActions, useEditorStore } from "../editor-store";

const accept = [".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".html", ".htm", ".paprika.json"];

const readDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read"));
    reader.readAsDataURL(file);
  });

const naturalSize = (src: string) =>
  new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || 1, height: image.naturalHeight || 1 });
    image.onerror = () => reject(new Error("invalid image"));
    image.src = src;
  });

type Outcome = { group: NodeInput[]; warnings: string[] } | { error: string };

/** One file to the nodes it makes, or the reason it cannot be placed (the old canvas's limits for pictures, `.fig`, PDF, and `.paprika.json` refused). */
async function convert(t: TFunction, entry: ImportedFilePayload): Promise<Outcome> {
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
      return { group: [imageNode(file, src, size)], warnings: [] };
    }
    if (kind === "svg" || kind === "html") {
      const text = entry.text ?? (await file.text());
      const { nodes, warnings } = parseMarkup(kind === "html" && /^\s*<svg[\s>]/i.test(text) ? "svg" : kind, text);
      return { group: nodes, warnings };
    }
    return { error: t("app.collab.import.unsupported", { name }) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { error: reason === "empty" ? t("app.collab.import.nothing", { name }) : t("app.collab.import.failed", { name, reason }) };
  }
}

/** Made while it is open (like the export dialog): only the Files tab, because the server has no import route for the others. */
function ImportContainer() {
  const { t } = useTranslation();
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
      const outcomes = await Promise.all(request.files.map((entry) => convert(t, entry)));
      const errors = outcomes.flatMap((outcome) => ("error" in outcome ? [outcome.error] : []));
      const done = outcomes.flatMap((outcome) => ("group" in outcome ? [outcome] : []));
      if (done.length === 0) throw new Error(errors.join(" "));
      const doc = client.store.state.doc;
      if (!doc) throw new Error(t("app.collab.import.offline"));
      const parentId = activePageId(doc, editor.state.pageId);
      const placed = placeNodes(doc, parentId, done.map((outcome) => outcome.group), done.flatMap((outcome) => outcome.warnings));
      try {
        await apply(placed.ops, t("app.collab.import.label", { count: done.length }));
      } catch (error) {
        throw isOfflineError(error) ? new Error(t("app.collab.import.offline")) : error;
      }
      select(placed.ids);
      if (errors.length > 0) showStatusToast({ status: "warning", title: t("app.collab.import.someFailed", { count: errors.length }), description: errors.join(" ") });
      else if (placed.warnings.length > 0) showStatusToast({ status: "warning", title: t("app.collab.import.warnings", { warnings: placed.warnings.join("; ") }) });
    },
    [apply, client, editor, select, t],
  );
  return <ImportDialog open onOpenChange={onOpenChange} destination={destination} tabs={["files"]} accept={accept} maxFileSize={IMAGE_BYTES} onImport={onImport} />;
}

export function Import() {
  const open = useEditor((s) => s.dialogs.import);
  return open ? <ImportContainer /> : null;
}
