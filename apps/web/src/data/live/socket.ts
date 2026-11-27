import { isDocFrame, type AckMessage, type ClientMessage, type ServerMessage } from "./protocol";

/** What the client needs from a `WebSocket`; tests pass a fake one through `SocketFactory`. */
export type SocketLike = {
  readyState: number;
  send: (data: string) => void;
  close: () => void;
  onopen: ((event?: unknown) => void) | null;
  onclose: ((event?: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror?: ((event?: unknown) => void) | null;
};

export type SocketFactory = (url: string) => SocketLike;

const OPEN = 1;

/** Reconnection delays in ms: 1 s, 2 s, then 5 s for every later attempt. */
export const reconnectDelays: readonly number[] = [1000, 2000, 5000];

export class LiveOfflineError extends Error {
  readonly code = "offline";
  constructor() {
    super("offline");
    this.name = "LiveOfflineError";
  }
}

/**
 * An offline error for a request that WAS sent: the connection dropped before the answer, and the server may have
 * applied it. It is still a `LiveOfflineError` (everything that handles "offline" keeps working); screens that can
 * tell the two apart say "may have been applied" instead of "was not sent", so the person checks before sending again
 * (a second `create` would duplicate).
 */
export class LiveInterruptedError extends LiveOfflineError {
  readonly interrupted = true;
  constructor() {
    super();
    this.name = "LiveInterruptedError";
  }
}

export class LiveRequestError extends Error {
  readonly code = "request";
  constructor(message: string) {
    super(message);
    this.name = "LiveRequestError";
  }
}

export const isOfflineError = (error: unknown): error is LiveOfflineError => error instanceof LiveOfflineError;
export const isInterruptedError = (error: unknown): error is LiveInterruptedError => error instanceof LiveInterruptedError;

export type SocketHandlers = {
  onOpen: () => void;
  onClose: () => void;
  /** Frames of the document (`doc`, `delta`), raw: parsed later in a batch. */
  onDocFrame: (raw: string) => void;
  /** Every other message, parsed. Acks that settled a request are forwarded too (the store checks the version). */
  onMessage: (message: ServerMessage) => void;
};

export type LiveSocketOptions = {
  url: string | (() => string);
  factory?: SocketFactory;
  delays?: readonly number[];
  handlers: SocketHandlers;
};

type Pending = { resolve: (ack: AckMessage) => void; reject: (error: Error) => void };

const defaultUrl = () => `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
const defaultFactory: SocketFactory = (url) => new WebSocket(url) as unknown as SocketLike;

/** Transport only: connection, reconnection with backoff, and `reqId` bookkeeping. It knows nothing about the document. */
export class LiveSocket {
  private ws: SocketLike | null = null;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private attempt = 0;
  private seq = 0;
  private running = false;
  private readonly pending = new Map<string, Pending>();
  private readonly options: LiveSocketOptions;

  constructor(options: LiveSocketOptions) {
    this.options = options;
  }

  get isOpen() {
    return this.ws?.readyState === OPEN;
  }

  get isRunning() {
    return this.running;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.open();
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    clearTimeout(this.retry);
    this.retry = undefined;
    this.attempt = 0;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onclose = ws.onmessage = null;
      ws.close();
    }
    this.rejectAll();
  }

  nextReqId() {
    return String(++this.seq);
  }

  /** Fire and forget; `false` when the socket is not open. */
  send(message: ClientMessage): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== OPEN) return false;
    ws.send(JSON.stringify(message));
    return true;
  }

  /** Resolved by the `ack` with the same `reqId`, rejected by its `error`, or when the connection drops. */
  request(message: ClientMessage): Promise<AckMessage> {
    const ws = this.ws;
    if (!ws || ws.readyState !== OPEN) return Promise.reject(new LiveOfflineError());
    const reqId = this.nextReqId();
    return new Promise<AckMessage>((resolve, reject) => {
      this.pending.set(reqId, { resolve, reject });
      try {
        ws.send(JSON.stringify({ ...message, reqId }));
      } catch (error) {
        this.pending.delete(reqId);
        reject(error instanceof Error ? error : new LiveOfflineError());
      }
    });
  }

  private rejectAll() {
    const all = [...this.pending.values()];
    this.pending.clear();
    for (const entry of all) entry.reject(new LiveInterruptedError());
  }

  private open() {
    const { url, factory = defaultFactory, handlers } = this.options;
    const ws = factory(typeof url === "function" ? url() : url);
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.attempt = 0;
      handlers.onOpen();
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.rejectAll();
      handlers.onClose();
      if (!this.running) return;
      const delays = this.options.delays ?? reconnectDelays;
      const delay = delays[Math.min(this.attempt, delays.length - 1)] as number;
      this.attempt += 1;
      this.retry = setTimeout(() => {
        this.retry = undefined;
        if (this.running) this.open();
      }, delay);
    };
    ws.onmessage = (event) => {
      if (this.ws !== ws) return;
      const raw = String(event.data);
      if (isDocFrame(raw)) {
        handlers.onDocFrame(raw);
        return;
      }
      let message: ServerMessage;
      try {
        message = JSON.parse(raw) as ServerMessage;
      } catch {
        return;
      }
      if (message.type === "doc" || message.type === "delta") {
        handlers.onDocFrame(raw);
        return;
      }
      if (message.type === "ack") {
        const entry = this.pending.get(message.reqId);
        if (entry) {
          this.pending.delete(message.reqId);
          entry.resolve(message);
        }
      } else if (message.type === "error" && message.reqId !== undefined) {
        const entry = this.pending.get(message.reqId);
        if (entry) {
          this.pending.delete(message.reqId);
          entry.reject(new LiveRequestError(message.message));
        }
        return;
      }
      handlers.onMessage(message);
    };
  }
}
