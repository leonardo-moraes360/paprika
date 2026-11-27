import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { dismissToasts } from "@/lib/notify";
import { docMessage, makeDocument, renderEditorRig, serveDocument } from "@/test/live-harness";

afterEach(() => {
  dismissToasts();
  document.title = "";
});

describe("/w/$workspaceId", () => {
  it("asks the server for the workspace in the URL, and shows the opening state with the connection state until it arrives", async () => {
    const view = await renderEditorRig({ workspaceId: "w-77" });
    expect(view.socket.sentOf("view")).toEqual([{ type: "view", workspaceId: "w-77", reqId: expect.any(String) }]);
    expect(screen.getByRole("status", { name: "Opening workspace" })).toBeInTheDocument();
    expect(screen.getByText("Loading the document from the server.")).toBeInTheDocument();
    act(() => view.socket.drop());
    expect(screen.getByText("Offline. Reconnecting…")).toBeInTheDocument();
    view.unmount();
  });

  it("does not mount the editor for a document of another workspace (the server falls back to the active one)", async () => {
    const view = await renderEditorRig({ workspaceId: "w-1" });
    view.rig.deliver(docMessage(makeDocument(10, { id: "other" }), 1));
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Opening workspace" })).toBeInTheDocument();
    serveDocument(view.rig, makeDocument(10, { id: "w-1", name: "Mine" }));
    expect(await screen.findByRole("banner")).toBeInTheDocument();
    view.unmount();
  });

  it("mounts the editor with the layout regions, the header path and the document name as the page title", async () => {
    const view = await renderEditorRig({ workspaceId: "w-1" });
    serveDocument(view.rig, makeDocument(10, { id: "w-1", name: "Checkout" }));
    expect(await screen.findByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Canvas" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Workspaces" })).toHaveAttribute("href", "/");
    expect(screen.getAllByText("Checkout").length).toBeGreaterThan(0);
    expect(screen.getByText("MCP at /mcp")).toBeInTheDocument();
    act(() => view.socket.drop());
    expect(screen.getByText("Disconnected")).toBeInTheDocument();
    act(() => view.rig.sockets.last.open());
    await waitFor(() => expect(document.title).toBe("Checkout · Paprika"));
    view.unmount();
    expect(document.title).toBe("Paprika");
  });

  it("goes back to the overview with a message when the server refuses the view", async () => {
    const view = await renderEditorRig({ workspaceId: "ghost" });
    act(() =>
      view.socket.receive({ type: "error", reqId: view.socket.lastReqId("view") as string, message: 'workspace "ghost" does not exist' }),
    );
    expect(await screen.findByTestId("overview-route")).toBeInTheDocument();
    expect(view.router.state.location.pathname).toBe("/");
    expect(await screen.findByText("Could not open the workspace")).toBeInTheDocument();
    expect(screen.getByText('workspace "ghost" does not exist')).toBeInTheDocument();
    view.unmount();
  });

  it("goes back to the overview when the workspace in view is deleted, and ignores the deletion of another", async () => {
    const view = await renderEditorRig({ workspaceId: "w-1" });
    serveDocument(view.rig, makeDocument(10, { id: "w-1" }));
    await screen.findByRole("banner");
    const op = (workspaceId: string) => ({ type: "workspaceOp" as const, op: { at: 1, actor: "user", op: "delete", workspaceId, workspaceName: "X", detail: {} } });
    view.rig.push(op("w-2"));
    expect(screen.getByRole("banner")).toBeInTheDocument();
    view.rig.push(op("w-1"));
    expect(await screen.findByTestId("overview-route")).toBeInTheDocument();
    expect(await screen.findByText("This workspace was deleted.")).toBeInTheDocument();
    view.unmount();
  });

  it("does not leave while the connection is down: the view is sent again when it is back", async () => {
    const view = await renderEditorRig({ workspaceId: "w-1" });
    act(() => view.socket.drop());
    expect(view.router.state.location.pathname).toBe("/w/w-1");
    view.unmount();
  });
});
