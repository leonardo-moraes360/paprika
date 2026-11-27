import { newId, type Document, type NodeInput, type Op } from "@paprika/core";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { CanvasInputRequest } from "@/components/frontends/canvas";
import { activePageId } from "@/adapters/export";
import { batchBySize, IMPORT_BATCH_BYTES, MarkupError, opsBytes, parseMarkup } from "@/adapters/import";
import { isInterruptedError, isOfflineError, useLiveActions, useLiveClient } from "@/data/live";
import { showStatusToast } from "@/lib/notify";
import { useEditorStore } from "./editor-store";
import { asList, convert, listOf, noteText } from "./regions/import";
import { useFailureText } from "./use-apply";

/** Gap between things placed side by side from one drop or paste, in px (as the old canvas). */
export const INPUT_GAP = 16;

type Group = { name: string; nodes: NodeInput[]; warnings: string[] };

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/** Flow layouts position their children: a thing put into one is pinned, as the old canvas does. */
function pinned(doc: Document, parentId: string | null, node: NodeInput): NodeInput {
  const parent = parentId ? doc.nodes[parentId] : undefined;
  const layout = parent && parent.type === "frame" ? parent.layout : undefined;
  return layout && layout.mode !== "none" ? ({ ...node, layoutPositioning: "absolute" } as NodeInput) : node;
}

/**
 * `create` ops for each group, the top-left corner of the first at `at` and the next ones to its right (the old canvas put
 * the second file beside the first). Every top-level node gets a new id. `byGroup[i]` is what group i made, for sending them in batches.
 */
export function placeAt(doc: Document, parentId: string | null, at: { x: number; y: number }, groups: readonly Group[]) {
  const byGroup: { ops: Op[]; ids: string[] }[] = [];
  let offset = 0;
  for (const group of groups) {
    const mine = { ops: [] as Op[], ids: [] as string[] };
    byGroup.push(mine);
    if (group.nodes.length === 0) continue;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    for (const node of group.nodes) {
      minX = Math.min(minX, num(node.x));
      minY = Math.min(minY, num(node.y));
      maxX = Math.max(maxX, num(node.x) + num(node.width));
    }
    for (const node of group.nodes) {
      const id = newId();
      const moved = pinned(doc, parentId, { ...node, id, x: Math.round(at.x + offset + num(node.x) - minX), y: Math.round(at.y + num(node.y) - minY) } as NodeInput);
      mine.ids.push(id);
      mine.ops.push({ op: "create", parentId, node: moved } as Op);
    }
    offset += maxX - minX + INPUT_GAP;
  }
  return byGroup;
}

/**
 * What the canvas does with a paste (SVG text, HTML, a picture) or dropped files: converts them with the dialog's own
 * adapters and limits (`adapters/import`: 3.5 MB a file, 5 M characters of data URI, 480 px on the long side; `.fig` and PDF refused with
 * the reason), puts them where the canvas says (the selected frame, the frame under the drop, else the page), sends them in
 * batches under the server's message limit and selects what came in. The callback is stable.
 */
export function useCanvasInputHandler(): (request: CanvasInputRequest) => void {
  const { t, i18n } = useTranslation();
  const client = useLiveClient();
  const editor = useEditorStore();
  const { apply } = useLiveActions();
  const failure = useFailureText();

  return useCallback(
    (request: CanvasInputRequest) => {
      const paste = request.kind === "paste";
      void (async () => {
        const groups: Group[] = [];
        const failures: string[] = [];
        const language = i18n.language;
        const markup = async (kind: "svg" | "html", text: string) => {
          try {
            const { nodes, warnings } = parseMarkup(kind, text);
            groups.push({ name: kind, nodes, warnings });
          } catch (error) {
            const reason = error instanceof MarkupError && error.notes.length > 0 ? listOf(language, error.notes.map((note) => noteText(t, note))) : t("app.canvas.input.pasteNothing");
            failures.push(t("app.canvas.input.pasteFailed", { reason }));
          }
        };
        let label = "";
        if (paste) {
          if (request.files.length > 0) {
            label = t("app.canvas.input.pasteImage");
            for (const file of request.files.slice(0, 1)) {
              const outcome = await convert(t, language, { file });
              if ("error" in outcome) failures.push(t("app.canvas.input.pasteFailed", { reason: outcome.error }));
              else groups.push({ name: outcome.name, nodes: outcome.group, warnings: outcome.warnings });
            }
          } else if (/^\s*<svg[\s>]/i.test(request.plain)) {
            label = t("app.canvas.input.pasteSvg");
            await markup("svg", request.plain);
          } else {
            label = t("app.canvas.input.pasteHtml");
            await markup("html", request.html);
          }
        } else {
          const outcomes = await Promise.all(request.files.map((file) => convert(t, language, { file })));
          for (const outcome of outcomes) {
            if ("error" in outcome) failures.push(outcome.error);
            else groups.push({ name: outcome.name, nodes: outcome.group, warnings: outcome.warnings });
          }
          label = request.files.length > 1 ? t("app.canvas.input.importMany", { count: request.files.length }) : t("app.canvas.input.importOne");
        }
        const doc = client.store.state.doc;
        if (!doc || groups.length === 0) {
          if (failures.length > 0) showStatusToast({ status: "danger", title: t("app.shell.actionFailedTitle"), description: failures.length === 1 ? failures[0] : asList(failures) });
          return;
        }
        const parentId = request.parentId && doc.nodes[request.parentId] ? request.parentId : activePageId(doc, editor.state.pageId);
        const placed = placeAt(doc, parentId, request.at, groups);
        const batches = batchBySize(placed.map((group) => opsBytes(group.ops)));
        const imported: string[] = [];
        let sent = 0;
        let stop = false;
        for (const batch of batches) {
          const names = batch.indexes.map((index) => (groups[index] as Group).name);
          if (stop) {
            failures.push(...names.map((name) => t("app.collab.import.notSent", { name })));
            continue;
          }
          if (batch.oversized) {
            failures.push(t("app.collab.import.tooBigToSend", { name: names[0], limit: IMPORT_BATCH_BYTES / 1_000_000 }));
            continue;
          }
          try {
            await apply(
              batch.indexes.flatMap((index) => (placed[index] as (typeof placed)[number]).ops),
              label,
            );
            imported.push(...batch.indexes.flatMap((index) => (placed[index] as (typeof placed)[number]).ids));
            sent += batch.indexes.length;
          } catch (error) {
            // The text says what happened (offline, may have been applied, the server's own words); a lost connection stops the rest.
            failures.push(failure(error));
            if (isInterruptedError(error) || isOfflineError(error)) stop = true;
          }
        }
        if (imported.length > 0) editor.actions.select(imported);
        if (failures.length > 0) {
          showStatusToast({ status: sent > 0 ? "warning" : "danger", title: t(sent > 0 ? "app.collab.import.partial" : "app.shell.actionFailedTitle", { done: sent, total: groups.length }), description: failures.length === 1 ? failures[0] : asList(failures) });
        } else {
          const warnings = [...new Set(groups.flatMap((group) => group.warnings))];
          if (warnings.length > 0) showStatusToast({ status: "warning", title: t(paste ? "app.canvas.input.pasteWarnings" : "app.collab.import.warnings"), description: asList(warnings.map((warning) => noteText(t, warning))) });
        }
      })();
    },
    [apply, client, editor, failure, i18n.language, t],
  );
}
