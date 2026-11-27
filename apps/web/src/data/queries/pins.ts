import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { api, jsonRequest } from "../api";
import { useLiveEvent } from "../live";

export type PinRegion = { x: number; y: number; width: number; height: number };
export type ServerPinStatus = "open" | "claimed" | "resolved";

export type ServerPinReply = { id: string; author: string; text: string; createdAt: number };

/** `Pin` of `server/internal/server/pins.go` (`GET /api/pins`). `author` and `claimedBy` are `"user"` or `"agent:<name>"`. */
export type ServerPin = {
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
  status: ServerPinStatus;
  claimedBy?: string;
  reply?: string;
  replies?: ServerPinReply[];
  resolvedBy?: string;
  createdAt: number;
  updatedAt: number;
};

export type NewServerPin = { workspaceId: string; pageId?: string | null; nodeId?: string | null; region: PinRegion; text: string };

export const pinsKey = (workspaceId: string) => ["pins", workspaceId] as const;

export const pinsQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: pinsKey(workspaceId),
    // An empty id would ask for the ACTIVE workspace of the server, which is not necessarily the one in view.
    enabled: workspaceId !== "",
    queryFn: async ({ signal }): Promise<ServerPin[]> => {
      const data = await api<{ pins?: ServerPin[] }>(`/api/pins?workspaceId=${encodeURIComponent(workspaceId)}&status=all`, { signal });
      return data.pins ?? [];
    },
  });

export const usePins = (workspaceId: string) => useQuery(pinsQuery(workspaceId));

/** Number of pins not resolved (open or claimed), from the same cached query as the panel. */
export const useOpenPinCount = (workspaceId: string) => useQuery({ ...pinsQuery(workspaceId), select: (pins) => pins.filter((pin) => pin.status !== "resolved").length }).data ?? 0;

/** The server announces a pins revision over the socket: refetch the list of this workspace. Mount once per editor. */
export function usePinsLiveSync(workspaceId: string) {
  const client = useQueryClient();
  useLiveEvent((event) => {
    if (event.type === "pins") void client.invalidateQueries({ queryKey: pinsKey(workspaceId) });
  });
}

export type PinActions = {
  create: (input: NewServerPin) => Promise<ServerPin>;
  setStatus: (id: string, status: "open" | "resolved") => Promise<ServerPin>;
  reply: (id: string, text: string) => Promise<ServerPin>;
  remove: (id: string) => Promise<void>;
};

/** Mutations of the pins of one workspace; every one refetches the list when it settles. Callbacks are stable. */
export function usePinActions(workspaceId: string): PinActions {
  const client = useQueryClient();
  const refresh = useCallback(() => client.invalidateQueries({ queryKey: pinsKey(workspaceId) }), [client, workspaceId]);
  const create = useMutation({
    mutationFn: (input: NewServerPin) =>
      api<{ pin: ServerPin }>("/api/pins", jsonRequest("POST", { workspaceId: input.workspaceId, pageId: input.pageId ?? undefined, nodeId: input.nodeId ?? undefined, region: input.region, text: input.text })).then((r) => r.pin),
    onSettled: refresh,
  });
  const patch = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "open" | "resolved" }) => api<{ pin: ServerPin }>(`/api/pins/${encodeURIComponent(id)}`, jsonRequest("PATCH", { status })).then((r) => r.pin),
    onSettled: refresh,
  });
  const reply = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) => api<{ pin: ServerPin }>(`/api/pins/${encodeURIComponent(id)}/replies`, jsonRequest("POST", { text })).then((r) => r.pin),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api<{ deleted: string }>(`/api/pins/${encodeURIComponent(id)}`, jsonRequest("DELETE")).then(() => undefined),
    onSettled: refresh,
  });
  const { mutateAsync: createAsync } = create;
  const { mutateAsync: patchAsync } = patch;
  const { mutateAsync: replyAsync } = reply;
  const { mutateAsync: removeAsync } = remove;
  return {
    create: createAsync,
    setStatus: useCallback((id, status) => patchAsync({ id, status }), [patchAsync]),
    reply: useCallback((id, text) => replyAsync({ id, text }), [replyAsync]),
    remove: removeAsync,
  };
}
