import type { Document, Node, Op } from "@paprika/core";

/**
 * Wire format of `/ws`, checked against `server/internal/server/http.go` (`clientMessage`, `serveWS`),
 * `docdelta.go`, `presence.go`, `pins_http.go` and `server/internal/team/team.go`.
 */

export type MapPatch<T> = { set?: Record<string, T>; del?: string[] };

export type RendererMode = "dom" | "wasm";

export type StepResultKind = "applied" | "conflict" | "nothing" | "missing" | (string & {});

/** Answer of `undo`/`redo` with `mode: "own" | "step"` (`ack.step`). */
export type StepResult = {
  result: StepResultKind;
  ord: number;
  label: string;
  actor: string;
  newer: number;
  withActor: string;
  withLabel: string;
};

export type WorkspaceOpKind = "create" | "rename" | "open" | "delete" | (string & {});

export type WorkspaceOp = {
  at: number;
  actor: string;
  op: WorkspaceOpKind;
  workspaceId: string;
  workspaceName: string;
  detail: Record<string, unknown>;
};

/** Raw status of the team sidecar (`paprika serve --team`); the adapter in `adapters/team` maps it to the frontend type. */
export type RawTeamStatus = Record<string, unknown>;

export type DocMessage = {
  type: "doc";
  doc: Document;
  version: number;
  actor: string;
  label: string;
  kind: string;
  canUndo: boolean;
  canRedo: boolean;
};

export type DeltaMessage = {
  type: "delta";
  id: string;
  version: number;
  base: number;
  actor: string;
  label: string;
  kind: string;
  canUndo: boolean;
  canRedo: boolean;
  name?: string;
  rootIds?: string[];
  nodes?: MapPatch<Node>;
  tokens?: MapPatch<unknown>;
  modes?: MapPatch<unknown>;
  tokenMeta?: MapPatch<unknown>;
  assets?: MapPatch<string>;
};

export type AckMessage = { type: "ack"; reqId: string; version: number; step?: StepResult };
export type ErrorMessage = { type: "error"; reqId?: string; message: string };
export type PresenceMessage = { type: "presence"; agent: string; actor: string; tool: string; nodes: string[]; idle: number };
export type TeamMessage = { type: "team"; status: RawTeamStatus };
export type PinsMessage = { type: "pins"; rev: number };
export type WorkspaceOpMessage = { type: "workspaceOp"; op: WorkspaceOp };
export type HelloMessage = { type: "hello"; renderer: RendererMode; reqId?: string };

export type ServerMessage =
  | DocMessage
  | DeltaMessage
  | AckMessage
  | ErrorMessage
  | PresenceMessage
  | TeamMessage
  | PinsMessage
  | WorkspaceOpMessage
  | HelloMessage;

export type ClientMessage =
  | { type: "ops"; ops: Op[]; label?: string; reqId?: string }
  | { type: "undo" | "redo"; mode?: "own" | "step"; step?: number; reqId?: string }
  | { type: "view"; workspaceId?: string; reqId?: string }
  | { type: "hello"; renderer: RendererMode; reqId?: string };

/** A frame that carries (part of) the document: handled in the batched path, never parsed twice. */
export const isDocFrame = (raw: string) => raw.startsWith('{"type":"doc"') || raw.startsWith('{"type":"delta"');
export const isFullDocFrame = (raw: string) => raw.startsWith('{"type":"doc"');
