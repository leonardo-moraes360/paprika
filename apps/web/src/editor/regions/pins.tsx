import { useFormatForDisplay } from "@tanstack/react-hotkeys";
import { layout, type Document } from "@paprika/core";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { NewPinForm, PinCard, PinsPanel, type NewPinInput, type PinTarget } from "@/components/frontends/pins";
import { pageOfNode } from "@/adapters/agents";
import { pinActors, toPinEntries } from "@/adapters/pins";
import { useLive, useLiveClient } from "@/data/live";
import { useOpenPinCount, usePinActions, usePins, usePinsLiveSync, type PinRegion, type ServerPin } from "@/data/queries/pins";
import { showStatusToast } from "@/lib/notify";
import { useAgentTones, useAssignTones } from "../collab";
import { useEditor, useEditorActions } from "../editor-store";
import { useActivePageId } from "../use-active-page";

const NO_PINS: readonly ServerPin[] = [];

/** What the header's pins chip needs: how many pins are not resolved, and a click that opens the panel. Safe to call from the header: it reads the same cached query as the panel. */
export function usePinsHeader() {
  const docId = useLive((s) => s.doc?.id ?? "");
  const pins = useOpenPinCount(docId);
  const { toggleDialog } = useEditorActions();
  const onPinsClick = useCallback(() => toggleDialog("pins"), [toggleDialog]);
  return { pins, onPinsClick };
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
  const { t } = useTranslation();
  const pins = usePins(docId).data ?? NO_PINS;
  const client = useLiveClient();
  const format = useFormatForDisplay();
  // The platform's own spelling of the send key (`Ctrl Enter`, `⌘ Enter`), like the properties panel's hints.
  const submitShortcut = useMemo(() => format("Mod+Enter", { parts: true }).map((key) => (key === "↵" ? "Enter" : key)), [format]);
  const { setTool, setPin, setPinPoint } = useEditorActions();
  const point = useEditor((s) => s.pinPoint);
  const pageId = useActivePageId();
  // What the canvas pointed at; before it did, the selected layer (the layers panel can point too).
  const selected = useEditor((s) => s.selection[s.selection.length - 1] ?? null);
  const nodeId = point ? point.nodeId : selected;
  const area = point && !point.nodeId ? point.region : null;
  const name = useLive((s) => (nodeId ? (s.doc?.nodes[nodeId]?.name ?? null) : null));
  const actions = usePinActions(docId);
  const exists = useLive((s) => (nodeId ? Boolean(s.doc?.nodes[nodeId]) : false));
  const number = useMemo(() => pins.reduce((max, pin) => Math.max(max, pin.n), 0) + 1, [pins]);
  const onCancel = useCallback(() => {
    setPinPoint(null);
    setTool("select");
  }, [setPinPoint, setTool]);
  const onSubmit = useCallback(
    async (input: NewPinInput) => {
      const doc = client.store.state.doc;
      if (area) {
        // An area (or a spot) on the page in view: no node, the box the person drew.
        const pin = await actions.create({ workspaceId: docId, pageId, nodeId: null, region: area, text: input.text });
        setTool("select");
        setPin(pin.id);
        return;
      }
      if (!doc || !nodeId || !doc.nodes[nodeId]) throw new Error(t("app.collab.pins.nodeGone"));
      const pin = await actions.create({ workspaceId: docId, pageId: pageOfNode(doc, nodeId), nodeId, region: point?.region ?? nodeRegion(doc, nodeId), text: input.text });
      setTool("select");
      setPin(pin.id);
    },
    [actions, area, client, docId, nodeId, pageId, point, setPin, setTool, t],
  );
  if (!area && (!nodeId || !exists)) return null;
  const target: PinTarget = area ? { kind: "area", width: area.width, height: area.height } : { kind: "node", name: name || (nodeId as string) };
  return <NewPinForm key={area ? `${area.x},${area.y},${area.width},${area.height}` : nodeId} number={number} target={target} maxLength={2000} showAttachRegion={false} showChangeHint={false} submitShortcut={submitShortcut} onSubmit={onSubmit} onCancel={onCancel} />;
}

function PinsPanels({ docId }: { docId: string }) {
  const { t } = useTranslation();
  const format = useFormatForDisplay();
  const shortcut = useMemo(() => format("Shift+I", { parts: true }), [format]);
  const query = usePins(docId);
  const pins = query.data ?? NO_PINS;
  const actions = usePinActions(docId);
  const client = useLiveClient();
  const tones = useAgentTones();
  const { closeDialog, setPin, select, setPage, focus } = useEditorActions();
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
  /** Takes the canvas to a pin: its page first when it is on another, then its node (or, for an area, the box it was drawn on). */
  const flyTo = useCallback(
    (id: string) => {
      const pin = pins.find((candidate) => candidate.id === id);
      const doc = client.store.state.doc;
      if (!pin || !doc) return;
      if (pin.pageId && doc.nodes[pin.pageId]) setPage(pin.pageId);
      if (pin.nodeId && doc.nodes[pin.nodeId]) focus({ nodes: [pin.nodeId] });
      else focus({ box: { x: pin.region.x, y: pin.region.y, width: Math.max(pin.region.width, 1), height: Math.max(pin.region.height, 1) } });
    },
    [client, focus, pins, setPage],
  );
  const onSelectPin = useCallback(
    (id: string) => {
      setPin(id);
      flyTo(id);
    },
    [flyTo, setPin],
  );
  const onCloseCard = useCallback(() => setPin(null), [setPin]);
  const pinId = selected?.id ?? "";
  const onReply = useCallback((text: string) => actions.reply(pinId, text), [actions, pinId]);
  const onSetStatus = useCallback((status: "open" | "resolved") => actions.setStatus(pinId, status), [actions, pinId]);
  const onDelete = useCallback(async () => {
    await actions.remove(pinId);
    setPin(null);
  }, [actions, pinId, setPin]);
  /** "Show" takes the page of the pin, selects its node and flies the camera to it. */
  const onShow = useCallback(() => {
    const pin = pins.find((candidate) => candidate.id === pinId);
    const doc = client.store.state.doc;
    if (!pin || !doc) return;
    flyTo(pinId);
    // After the page change, which clears the selection.
    if (pin.nodeId && doc.nodes[pin.nodeId]) select([pin.nodeId]);
  }, [client, flyTo, pins, pinId, select]);

  return (
    <div className="fixed start-66 top-30 z-30 flex max-h-[calc(100dvh-8.5rem)] w-85 max-w-[calc(100vw-1.5rem)] flex-col gap-3 overflow-y-auto" data-testid="pins-region">
      <PinsPanel pins={entries} selectedId={selectedId} onSelectPin={onSelectPin} onClose={onClose} shortcut={shortcut} />
      {selected ? <PinCard pin={selected} onReply={onReply} onSetStatus={onSetStatus} onDelete={onDelete} onShow={onShow} onClose={onCloseCard} /> : null}
    </div>
  );
}

/**
 * Forgets the selected pin when it leaves the list (an agent or another editor deleted it), so `pinId` does not point at
 * nothing. Only a pin that was in the list once is forgotten: one just created is selected before the refetch brings it.
 */
function useForgetDeletedPin(docId: string) {
  const query = usePins(docId);
  const { setPin } = useEditorActions();
  const selectedId = useEditor((s) => s.pinId);
  const seen = useRef<string | null>(null);
  const listed = query.data?.some((pin) => pin.id === selectedId) ?? false;
  useEffect(() => {
    if (!selectedId) {
      seen.current = null;
      return;
    }
    if (listed) seen.current = selectedId;
    else if (query.isSuccess && seen.current === selectedId) {
      seen.current = null;
      setPin(null);
    }
  }, [selectedId, listed, query.isSuccess, setPin]);
}

/** The width from which the pins panel (264 + 340) and the new-pin form (360 + the 320 right column + 16) fit side by side. */
const SIDE_BY_SIDE_MIN = 1320;

/** On a narrow window the pins panel and the new-pin form would overlap: the one that opens last closes the other. */
function useOneAtATime(open: boolean, pinning: boolean) {
  const { closeDialog, setTool } = useEditorActions();
  const before = useRef({ open, pinning });
  useEffect(() => {
    const prev = before.current;
    before.current = { open, pinning };
    if (!open || !pinning || window.innerWidth >= SIDE_BY_SIDE_MIN) return;
    if (!prev.pinning) closeDialog("pins");
    else setTool("select");
  }, [open, pinning, closeDialog, setTool]);
  // A window made narrower while both are open: the panel (the older of the two) goes.
  useEffect(() => {
    if (!open || !pinning) return;
    const onResize = () => window.innerWidth < SIDE_BY_SIDE_MIN && closeDialog("pins");
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, pinning, closeDialog]);
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
  useOneAtATime(open, pinning);
  usePinsLiveSync(docId);
  useForgetDeletedPin(docId);
  if (!docId) return null;
  return (
    <>
      {open ? <PinsPanels docId={docId} /> : null}
      {pinning ? (
        <div className="fixed end-84 top-30 z-30 w-90 max-w-[calc(100vw-1.5rem)]" data-testid="new-pin-region">
          <NewPin docId={docId} />
        </div>
      ) : null}
    </>
  );
}
