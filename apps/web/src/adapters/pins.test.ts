import { describe, expect, it } from "vitest";
import type { ServerPin } from "@/data/queries/pins";
import { pinActors, pinTarget, toPinEntries, toPinEntry } from "./pins";

const base: ServerPin = { id: "x1", n: 1, workspaceId: "w", region: { x: 1, y: 2, width: 100, height: 40 }, text: "Make it bigger", author: "user", status: "open", createdAt: 10, updatedAt: 20 };

describe("pinTarget", () => {
  it("is the node (by its name, else its id), an area, or a node that is gone", () => {
    expect(pinTarget({ ...base, nodeId: "n1", nodeName: "Button" })).toEqual({ kind: "node", name: "Button" });
    expect(pinTarget({ ...base, nodeId: "n1" })).toEqual({ kind: "node", name: "n1" });
    expect(pinTarget({ ...base, nodeId: "n1", nodeName: "Button", nodeMissing: true })).toEqual({ kind: "missing" });
    expect(pinTarget(base)).toEqual({ kind: "area", width: 100, height: 40 });
  });
});

describe("toPinEntry", () => {
  const tones = { "agent:claude": "agent-2" } as const;

  it("maps the number, status, text, time and the author of the human as you", () => {
    expect(toPinEntry(base, tones)).toEqual({ id: "x1", number: 1, status: "open", text: "Make it bigger", author: { name: "user", you: true }, createdAt: 10, target: { kind: "area", width: 100, height: 40 }, replies: [] });
  });

  it("gives the single reply to whoever resolved the pin, before whoever claimed it", () => {
    const entry = toPinEntry({ ...base, status: "resolved", reply: "Done", claimedBy: "agent:codex", resolvedBy: "agent:claude", updatedAt: 99 }, tones);
    expect(entry.replies[0]!.author.name).toBe("claude");
  });

  it("shows an agent author and claimant by name and tone", () => {
    const entry = toPinEntry({ ...base, author: "agent:codex", status: "claimed", claimedBy: "agent:claude" }, tones);
    expect(entry.author.name).toBe("codex");
    expect(entry.author.you).toBeUndefined();
    expect(entry.claimedBy).toEqual({ name: "claude", tone: "agent-2" });
  });

  it("maps the thread with who wrote each message", () => {
    const entry = toPinEntry({ ...base, replies: [{ id: "r1", author: "agent:claude", text: "On it", createdAt: 30 }, { id: "r2", author: "user", text: "Thanks", createdAt: 40 }] }, tones);
    expect(entry.replies.map((reply) => [reply.author.name, reply.author.you ?? false, reply.text])).toEqual([["claude", false, "On it"], ["user", true, "Thanks"]]);
  });

  it("turns the single reply of an older pin into one message from whoever closed it", () => {
    const entry = toPinEntry({ ...base, status: "resolved", reply: "Done", resolvedBy: "agent:claude", updatedAt: 99 }, tones);
    expect(entry.replies).toEqual([{ id: "x1:reply", author: { name: "claude", tone: "agent-2" }, text: "Done", createdAt: 99 }]);
  });

  it("gives the same object for the same pin and tones, and a new one when a tone changes", () => {
    const pin = { ...base, status: "claimed" as const, claimedBy: "agent:claude" };
    expect(toPinEntry(pin, tones)).toBe(toPinEntry(pin, tones));
    expect(toPinEntry(pin, { "agent:claude": "agent-4" })).not.toBe(toPinEntry(pin, tones));
    expect(toPinEntries([pin], tones)[0]).toBe(toPinEntry(pin, tones));
  });
});

describe("pinActors", () => {
  it("lists each agent that appears as author, claimant, closer or replier, never the human", () => {
    const pins: ServerPin[] = [
      { ...base, author: "agent:a", claimedBy: "agent:b" },
      { ...base, id: "x2", resolvedBy: "agent:c", replies: [{ id: "r", author: "agent:a", text: "t", createdAt: 1 }, { id: "q", author: "user", text: "t", createdAt: 1 }] },
    ];
    expect(pinActors(pins).sort()).toEqual(["agent:a", "agent:b", "agent:c"]);
  });
});
