import { describe, expect, it } from "vitest";
import { isInterruptedError, isOfflineError, LiveInterruptedError, LiveOfflineError, LiveSocket, type SocketLike } from "./socket";

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: string[] = [];
  onopen: SocketLike["onopen"] = null;
  onclose: SocketLike["onclose"] = null;
  onmessage: SocketLike["onmessage"] = null;
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
}

function setup() {
  const sockets: FakeSocket[] = [];
  const socket = new LiveSocket({
    url: "ws://test/ws",
    factory: () => {
      const fake = new FakeSocket();
      sockets.push(fake);
      return fake;
    },
    delays: [1_000_000],
    handlers: { onOpen: () => {}, onClose: () => {}, onDocFrame: () => {}, onMessage: () => {} },
  });
  socket.start();
  sockets[0]!.readyState = 1;
  sockets[0]!.onopen?.();
  return { socket, fake: sockets[0]! };
}

describe("a request when the connection drops", () => {
  it("that was already sent is rejected as interrupted (it may have been applied), and still counts as offline", async () => {
    const { socket, fake } = setup();
    const pending = socket.request({ type: "ops", ops: [], label: "x" });
    expect(fake.sent).toHaveLength(1);
    fake.readyState = 3;
    fake.onclose?.();
    const error = await pending.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(LiveInterruptedError);
    expect(isInterruptedError(error)).toBe(true);
    expect(isOfflineError(error)).toBe(true);
    socket.stop();
  });

  it("that was never sent (the socket was down) is plain offline, not interrupted", async () => {
    const { socket, fake } = setup();
    fake.readyState = 3;
    fake.onclose?.();
    const error = await socket.request({ type: "ops", ops: [], label: "x" }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(LiveOfflineError);
    expect(isInterruptedError(error)).toBe(false);
    socket.stop();
  });
});
