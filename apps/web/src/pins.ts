import { useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

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

export const actorLabel = (actor: string | undefined) => (actor ?? "").replace(/^agent:/, "") || "agente";

export const onPage = (pins: Pin[], pageId: string | null) => pins.filter((p) => p.status !== "resolved" && (p.pageId ?? "") === (pageId ?? ""));
