import { describe, expect, it } from "vitest";
import { actorName, actorTone, toNoticeEntry } from "./notice";
import type { LiveNotice } from "./notice";

const notice = (extra: Partial<LiveNotice> = {}): LiveNotice => ({ id: 3, actor: "agent:claude", op: "delete", workspaceName: "Checkout", detail: {}, ...extra });

describe("notice adapter", () => {
  it("maps the live notice: id as text, the actor without the agent prefix, the workspace name", () => {
    expect(toNoticeEntry(notice())).toMatchObject({ id: "3", actor: { name: "claude" }, op: "delete", workspaceName: "Checkout" });
    expect(actorName("agent:claude")).toBe("claude");
    expect(actorName("codex")).toBe("codex");
  });

  it("keeps only the positive counts the server sent, as numbers", () => {
    const entry = toNoticeEntry(notice({ detail: { nodes: 12, pages: "2", frames: 0, images: "x", historyEntries: 5, other: 9 } }));
    expect(entry?.counts).toEqual({ nodes: 12, pages: 2, historyEntries: 5 });
    expect(toNoticeEntry(notice({ detail: {} }))?.counts).toBeUndefined();
  });

  it("gives the same actor the same tone, one of the four", () => {
    expect(actorTone("agent:claude")).toBe(actorTone("agent:claude"));
    expect(["agent-1", "agent-2", "agent-3", "agent-4"]).toContain(actorTone("agent:other"));
    const tones = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map((n) => actorTone(`agent:${n}`)));
    expect(tones.size).toBeGreaterThan(1);
  });

  it("returns the same entry for the same notice object, and null for no notice or an operation with no sentence", () => {
    const n = notice();
    expect(toNoticeEntry(n)).toBe(toNoticeEntry(n));
    expect(toNoticeEntry(null)).toBeNull();
    expect(toNoticeEntry(notice({ op: "archive" }))).toBeNull();
  });
});
