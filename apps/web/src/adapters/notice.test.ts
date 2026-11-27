import { describe, expect, it } from "vitest";
import type { WorkspaceNotice } from "@/data/live/protocol";
import { noticeCounts, toNoticeEntry } from "./notice";

const notice = (over: Partial<WorkspaceNotice> = {}): WorkspaceNotice => ({
  id: 3,
  actor: "agent:claude",
  op: "delete",
  workspaceName: "Old",
  detail: { nodes: 12, pages: 2, frames: 0, images: "3", connectors: -1, historyEntries: 40.7, other: 9 },
  ...over,
});

describe("noticeCounts", () => {
  it("keeps the positive counts the frontend knows, as whole numbers", () => {
    expect(noticeCounts(notice().detail)).toEqual({ nodes: 12, pages: 2, images: 3, historyEntries: 40 });
    expect(noticeCounts({})).toBeUndefined();
  });
});

describe("toNoticeEntry", () => {
  it("is null without a notice or for an operation it has no wording for", () => {
    expect(toNoticeEntry(null)).toBeNull();
    expect(toNoticeEntry(notice({ op: "create" }), {})).toBeNull();
    expect(toNoticeEntry(notice({ op: "archive" }))).toBeNull();
  });

  it("names the agent with the tone the editor gave it and carries the counts only for a deletion", () => {
    expect(toNoticeEntry(notice(), { "agent:claude": "agent-3" })).toEqual({
      id: "3",
      actor: { name: "claude", tone: "agent-3" },
      op: "delete",
      workspaceName: "Old",
      counts: { nodes: 12, pages: 2, images: 3, historyEntries: 40 },
    });
    expect(toNoticeEntry(notice({ op: "rename" }), {})).not.toHaveProperty("counts");
  });

  it("without tones (the overview has no editor state) the tone is a stable pick from the name, and the same notice gives the same entry", () => {
    const n = notice();
    expect(toNoticeEntry(n)).toBe(toNoticeEntry(n));
    expect(toNoticeEntry(n)?.actor.tone).toBe(toNoticeEntry(notice())?.actor.tone);
    expect(["agent-1", "agent-2", "agent-3", "agent-4"]).toContain(toNoticeEntry(n)?.actor.tone);
  });
});
