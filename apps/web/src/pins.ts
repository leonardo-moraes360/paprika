import { useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

/**
 * Pins ("Apontar para a IA"): requests the human leaves on the canvas for the agents, anchored to a node
 * or an area. They are not nodes: the server keeps them in their own table and the agents read them
 * over MCP (`list_pins`, `claim_pin`, `reply_pin`, `resolve_pin`). The WebSocket only says when they changed
 * (`{type:"pins"}`), and the list is read again here.
 */
export interface PinRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PinStatus = "open" | "claimed" | "resolved";

export interface Pin {
  id: string;
  n: number;
  workspaceId: string;
  pageId?: string;
  nodeId?: string;
  nodeName?: string;
  nodeMissing?: boolean;
  region: PinRegion;
  text: string;
  author: string;
  status: PinStatus;
  claimedBy?: string;
  reply?: string;
  replies?: { id: string; author: string; text: string; createdAt: number }[];
  resolvedBy?: string;
  createdAt: number;
  updatedAt: number;
}

export const pinsKey = (workspaceId: string) => ["pins", workspaceId] as const;

/** Every pin of a workspace (open, claimed and resolved), by number. */
export function usePins(workspaceId: string) {
  return useQuery({
    queryKey: pinsKey(workspaceId),
    queryFn: async ({ signal }) => (await api<{ pins: Pin[] }>(`/api/pins?workspaceId=${encodeURIComponent(workspaceId)}&status=all`, { signal })).pins,
  });
}

const send = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: body === undefined ? undefined : { "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export interface NewPin {
  workspaceId: string;
  pageId: string | null;
  nodeId: string | null;
  region: PinRegion;
  text: string;
}

/** Creates, changes and deletes pins; each refreshes the list (the WebSocket does too, for the others). */
export function usePinActions(workspaceId: string) {
  const client = useQueryClient();
  const onSettled = () => client.invalidateQueries({ queryKey: pinsKey(workspaceId) });
  const create = useMutation({
    mutationFn: (p: NewPin) =>
      api<{ pin: Pin }>(
        "/api/pins",
        send("POST", { workspaceId: p.workspaceId, pageId: p.pageId ?? undefined, nodeId: p.nodeId ?? undefined, region: p.region, text: p.text }),
      ),
    onSettled,
  });
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { status?: "open" | "resolved"; text?: string } }) =>
      api<{ pin: Pin }>(`/api/pins/${encodeURIComponent(id)}`, send("PATCH", body)),
    onSettled,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api<{ deleted: string }>(`/api/pins/${encodeURIComponent(id)}`, send("DELETE")),
    onSettled,
  });
  const reply = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) => api<{ pin: Pin }>(`/api/pins/${encodeURIComponent(id)}/replies`, send("POST", { text })),
    onSettled,
  });
  return { create, patch, remove, reply };
}

/** Whether the Pins panel is open (shared by the top bar chip, Shift+I and the canvas). */
let panelOpen = false;
const listeners = new Set<() => void>();
export function setPinsPanel(open: boolean | ((was: boolean) => boolean)) {
  const next = typeof open === "function" ? open(panelOpen) : open;
  if (next === panelOpen) return;
  panelOpen = next;
  for (const l of listeners) l();
}
export function usePinsPanel(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => panelOpen,
  );
}

/** "agent:claude-code" → "claude-code"; "user" stays. */
export const actorLabel = (actor: string | undefined) => (actor ?? "").replace(/^agent:/, "") || "agente";

/** Pins that show on the canvas of a page: open and claimed ones (resolved ones only in the panel). */
export const onPage = (pins: Pin[], pageId: string | null) => pins.filter((p) => p.status !== "resolved" && (p.pageId ?? "") === (pageId ?? ""));
