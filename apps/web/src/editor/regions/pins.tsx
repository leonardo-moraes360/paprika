import { layout, type Document } from "@paprika/core";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { NewPinForm, PinCard, PinsPanel, type NewPinInput, type PinTarget } from "@/components/frontends/pins";
import { pinActors, toPinEntries } from "@/adapters/pins";
import { useLive, useLiveClient } from "@/data/live";
import { useOpenPinCount, usePinActions, usePins, usePinsLiveSync, type PinRegion, type ServerPin } from "@/data/queries/pins";
import { showStatusToast } from "@/lib/notify";
import { useAgentTones, useAssignTones } from "../collab";
import { useEditor, useEditorActions } from "../editor-store";

const NO_PINS: readonly ServerPin[] = [];
const shortcut = ["Shift", "I"] as const;
const mac = typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform);
const submitShortcut = [mac ? "\u2318" : "Ctrl", "Enter"] as const;

/** What the header's pins chip needs: how many pins are not resolved, and a click that opens the panel. Safe to call from the header: it reads the same cached query as the panel. */
export function usePinsHeader() {
  const docId = useLive((s) => s.doc?.id ?? "");
  const pins = useOpenPinCount(docId);
  const { toggleDialog } = useEditorActions();
  const onPinsClick = useCallback(() => toggleDialog("pins"), [toggleDialog]);
  return { pins, onPinsClick };
}

/** The page that holds a node (`null` when the document has no pages). */
function pageOf(doc: Document, nodeId: string): string | null {
  let node = doc.nodes[nodeId];
  for (let guard = 0; node && guard < 1000; guard += 1) {
    if (node.type === "page") return node.id;
    node = node.parentId ? doc.nodes[node.parentId] : undefined;
  }
  return null;
}

/**
 * The box of a node in canvas coordinates, from the layout of `@paprika/core` (the old app measures the node's element; this is the same box).
 * Falls back to the node's own numbers when the layout has none.
 */
function nodeRegion(doc: Document, nodeId: string): PinRegion {
  const node = doc.nodes[nodeId] as { x?: number; y?: number; width?: unknown; height?: unknown } | undefined;
  let top = doc.nodes[nodeId];
  while (top?.parentId && doc.nodes[top.parentId]?.type !== "page") top = doc.nodes[top.parentId];
  const box = top ? layout(doc, { rootId: top.id })[nodeId] : undefined;
  const round = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0);
  if (box) return { x: round(box.x), y: round(box.y), width: Math.max(0, round(box.width)), height: Math.max(0, round(box.height)) };
  return { x: round(node?.x), y: round(node?.y), width: Math.max(0, round(node?.width)), height: Math.max(0, round(node?.height)) };
}

/** The new-pin form for the selected node (the tool `pin` is on). Pointing at an area needs the canvas and waits for it. */
function NewPin({ docId }: { docId: string }) {
  const pins = usePins(docId).data ?? NO_PINS;
  const client = useLiveClient();
  const { setTool, setPin } = useEditorActions();
  const nodeId = useEditor((s) => s.selection[s.selection.length - 1] ?? null);
  const name = useLive((s) => (nodeId ? (s.doc?.nodes[nodeId]?.name ?? null) : null));
  const actions = usePinActions(docId);
  const exists = useLive((s) => (nodeId ? Boolean(s.doc?.nodes[nodeId]) : false));
  const number = useMemo(() => pins.reduce((max, pin) => Math.max(max, pin.n), 0) + 1, [pins]);
  const onCancel = useCallback(() => setTool("select"), [setTool]);
  const onSubmit = useCallback(
    async (input: NewPinInput) => {
      const doc = client.store.state.doc;
      if (!doc || !nodeId || !doc.nodes[nodeId]) throw new Error("The selected node is gone.");
      const pin = await actions.create({ workspaceId: docId, pageId: pageOf(doc, nodeId), nodeId, region: nodeRegion(doc, nodeId), text: input.text });
      setTool("select");
      setPin(pin.id);
    },
    [actions, client, docId, nodeId, setPin, setTool],
  );
  if (!nodeId || !exists) return null;
  const target: PinTarget = { kind: "node", name: name || nodeId };
  return <NewPinForm key={nodeId} number={number} target={target} maxLength={2000} showAttachRegion={false} showChangeHint={false} submitShortcut={submitShortcut} onSubmit={onSubmit} onCancel={onCancel} />;
}

function PinsPanels({ docId }: { docId: string }) {
  const { t } = useTranslation();
  const query = usePins(docId);
  const pins = query.data ?? NO_PINS;
  const actions = usePinActions(docId);
  const client = useLiveClient();
  const tones = useAgentTones();
  const { closeDialog, setPin, select, setPage } = useEditorActions();
  const selectedId = useEditor((s) => s.pinId);
  useAssignTones(useMemo(() => pinActors(pins), [pins]));
  const entries = useMemo(() => toPinEntries(pins, tones), [pins, tones]);
  const selected = selectedId ? entries.find((entry) => entry.id === selectedId) : undefined;

  const failed = useRef(false);
  useEffect(() => {
    if (query.isError && !failed.current) showStatusToast({ status: "danger", title: t("app.collab.pins.loadFailed"), description: query.error.message });
    failed.current = query.isError;
  }, [query.isError, query.error, t]);

  const onClose = useCallback(() => closeDialog("pins"), [closeDialog]);
  const onSelectPin = useCallback((id: string) => setPin(id), [setPin]);
  const onCloseCard = useCallback(() => setPin(null), [setPin]);
  const pinId = selected?.id ?? "";
  const onReply = useCallback((text: string) => actions.reply(pinId, text), [actions, pinId]);
  const onSetStatus = useCallback((status: "open" | "resolved") => actions.setStatus(pinId, status), [actions, pinId]);
  const onDelete = useCallback(async () => {
    await actions.remove(pinId);
    setPin(null);
  }, [actions, pinId, setPin]);
  /** Without a canvas to fly to, "show" takes the page of the pin and selects its node. */
  const onShow = useCallback(() => {
    const pin = pins.find((candidate) => candidate.id === pinId);
    const doc = client.store.state.doc;
    if (!pin || !doc) return;
    if (pin.pageId && doc.nodes[pin.pageId]) setPage(pin.pageId);
    if (pin.nodeId && doc.nodes[pin.nodeId]) select([pin.nodeId]);
  }, [client, pins, pinId, select, setPage]);

  return (
    <div className="fixed start-66 top-14 z-30 flex max-h-[calc(100dvh-4.5rem)] w-85 max-w-[calc(100vw-1.5rem)] flex-col gap-3 overflow-y-auto" data-testid="pins-region">
      <PinsPanel pins={entries} selectedId={selectedId} onSelectPin={onSelectPin} onClose={onClose} shortcut={shortcut} />
      {selected ? <PinCard pin={selected} onReply={onReply} onSetStatus={onSetStatus} onDelete={onDelete} onShow={onShow} onClose={onCloseCard} /> : null}
    </div>
  );
}

/**
 * Pins: the panel opens by the editor flag (`dialogs.pins`), the card shows the selected pin, and the new-pin form
 * (tool `pin`) points at the selected node. Pointing at an area waits for the canvas. The server announces a pins
 * revision over the socket and the list is refetched here, so a pin an agent claims or answers shows up by itself.
 */
export function Pins() {
  const docId = useLive((s) => s.doc?.id ?? "");
  const open = useEditor((s) => s.dialogs.pins);
  const pinning = useEditor((s) => s.tool === "pin");
  usePinsLiveSync(docId);
  if (!docId) return null;
  return (
    <>
      {open ? <PinsPanels docId={docId} /> : null}
      {pinning ? (
        <div className="fixed end-84 top-14 z-30 w-90 max-w-[calc(100vw-1.5rem)]" data-testid="new-pin-region">
          <NewPin docId={docId} />
        </div>
      ) : null}
    </>
  );
}
