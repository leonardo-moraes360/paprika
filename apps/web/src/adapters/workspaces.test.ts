import { describe, expect, it } from "vitest";
import type { ServerWorkspace } from "@/data/queries/workspaces";
import { toProjectEntries, toWorkspaceEntries, toWorkspaceEntry } from "./workspaces";

const ws = (id: string, extra: Partial<ServerWorkspace> = {}): ServerWorkspace => ({
  id,
  name: `Name ${id}`,
  nodes: 5,
  updatedAt: 100,
  active: false,
  cover: null,
  archived: false,
  folderId: "",
  preview: [],
  ...extra,
});

describe("workspaces adapter", () => {
  it("maps the server row to the overview entry (folder id becomes projectId, empty means none)", () => {
    const entry = toWorkspaceEntry(ws("a", { active: true, folderId: "f1", cover: "/api/workspaces/a/cover?v=1" }), true);
    expect(entry).toEqual({
      id: "a",
      name: "Name a",
      nodes: 5,
      updatedAt: 100,
      active: true,
      archived: false,
      projectId: "f1",
      cover: "/api/workspaces/a/cover?v=1",
      canArchive: true,
      canDelete: true,
    });
    expect(toWorkspaceEntry(ws("b"), true).projectId).toBeNull();
  });

  it("returns the same entry for the same server object, so an unchanged row does not render again", () => {
    const row = ws("a");
    expect(toWorkspaceEntry(row, true)).toBe(toWorkspaceEntry(row, true));
    expect(toWorkspaceEntry(row, true)).not.toBe(toWorkspaceEntry(row, false));
    expect(toWorkspaceEntries([row, ws("b")])[0]).toBe(toWorkspaceEntries([row, ws("c")])[0]);
  });

  it("forbids archiving and deleting the last workspace that is not archived (the server refuses it)", () => {
    const [only] = toWorkspaceEntries([ws("a")]);
    expect(only).toMatchObject({ canArchive: false, canDelete: false });
    const [first, second] = toWorkspaceEntries([ws("a"), ws("b")]);
    expect(first).toMatchObject({ canArchive: true, canDelete: true });
    expect(second).toMatchObject({ canArchive: true, canDelete: true });
  });

  it("lets an archived workspace be restored and deleted while one stays open", () => {
    const [archived] = toWorkspaceEntries([ws("a", { archived: true }), ws("b")]);
    expect(archived).toMatchObject({ archived: true, canArchive: true, canDelete: true });
  });

  it("maps folders to projects", () => {
    expect(toProjectEntries([{ id: "f", name: "Apps", updatedAt: 1 }])).toEqual([{ id: "f", name: "Apps" }]);
  });

  it("when every workspace is archived none can be deleted, but restoring (canArchive on an archived one) stays allowed", () => {
    const [entry] = toWorkspaceEntries([ws("a", { archived: true })]);
    expect(entry?.canDelete).toBe(false);
    expect(entry?.canArchive).toBe(true);
  });
});
