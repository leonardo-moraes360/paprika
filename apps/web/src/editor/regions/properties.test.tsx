import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Notifications } from "@/components/notifications";
import { LiveProvider } from "@/data/live";
import { dismissToasts } from "@/lib/notify";
import { createLiveRig, docMessage, makeDocument, nodeDelta, type LiveRig } from "@/test/live-harness";
import { EditorProvider, initialEditorState, useEditorStore, type EditorActions } from "../editor-store";
import { ACTIVITY_REFRESH_MS } from "./activity";
import { Properties } from "./properties";

afterEach(() => {
  vi.useRealTimers();
  dismissToasts();
});

async function mount(rig: LiveRig = createLiveRig()) {
  const doc = makeDocument(60, { perFrame: 20 });
  let actions!: EditorActions;
  let store!: ReturnType<typeof useEditorStore>;
  function Grab() {
    store = useEditorStore();
    actions = store.actions;
    return null;
  }
  const view = render(
    <LiveProvider client={rig.client}>
      <EditorProvider initial={initialEditorState}>
        <Grab />
        <Properties />
      </EditorProvider>
      <Notifications />
    </LiveProvider>,
  );
  const socket = await rig.connect();
  rig.deliver(docMessage(doc, 1));
  const ids = Object.keys(doc.nodes).filter((id) => id.startsWith("n"));
  return { ...view, rig, socket, doc, ids, select: (next: string[]) => act(() => actions.select(next)), selection: () => store.state.selection };
}

describe("Properties region", () => {
  it("shows the document panel with nothing selected and the node panel for a selected node", async () => {
    const view = await mount();
    expect(screen.getByTestId("document-panel")).toBeInTheDocument();
    view.select([view.ids[0] as string]);
    expect(screen.getByTestId("node-panel")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(view.doc.nodes[view.ids[0] as string]?.name);
    view.unmount();
  });

  it("remembers the collapsed sections under paprika.properties.sections (one prefix, not paprika.paprika.)", async () => {
    const user = userEvent.setup();
    window.localStorage.clear();
    const view = await mount();
    view.select([view.ids[0] as string]);
    await user.click(screen.getByRole("button", { name: "Position and size" }));
    expect(window.localStorage.getItem("paprika.properties.sections")).toBe(JSON.stringify({ position: false }));
    expect(window.localStorage.getItem("paprika.paprika.properties.sections")).toBeNull();
    window.localStorage.clear();
    view.unmount();
  });

  it("moves the sections stored under the doubled prefix to the current key once, and keeps the current one when both exist", async () => {
    window.localStorage.clear();
    window.localStorage.setItem("paprika.paprika.properties.sections", JSON.stringify({ position: false }));
    const first = await mount();
    expect(window.localStorage.getItem("paprika.properties.sections")).toBe(JSON.stringify({ position: false }));
    expect(window.localStorage.getItem("paprika.paprika.properties.sections")).toBeNull();
    first.unmount();
    window.localStorage.setItem("paprika.paprika.properties.sections", JSON.stringify({ position: true }));
    const second = await mount();
    expect(window.localStorage.getItem("paprika.properties.sections")).toBe(JSON.stringify({ position: false }));
    expect(window.localStorage.getItem("paprika.paprika.properties.sections")).toBeNull();
    second.unmount();
    window.localStorage.clear();
  });

  it("sends an edit as an `update` op with its label and follows the delta the server answers with", async () => {
    const user = userEvent.setup();
    const view = await mount();
    const id = view.ids[0] as string;
    view.select([id]);
    const name = screen.getByRole("textbox", { name: "Name" });
    await user.clear(name);
    await user.type(name, "Hero{Enter}");
    const [sent] = view.socket.sentOf("ops");
    expect(sent?.ops).toEqual([{ op: "update", id, props: { name: "Hero" } }]);
    expect(sent?.label).toBeTruthy();
    view.socket.ack(sent?.reqId, 2);
    view.rig.deliver(nodeDelta(view.doc, id, { name: "Hero" }, 2));
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Hero");
    view.unmount();
  });

  it("groups the selection and selects the group once the server accepted it, not before", async () => {
    const user = userEvent.setup();
    const view = await mount();
    const [a, b] = view.ids as [string, string];
    view.select([a, b]);
    await user.click(screen.getByRole("button", { name: "Group" }));
    const [sent] = view.socket.sentOf("ops");
    const op = sent?.ops[0] as { op: string; id: string; ids: string[] };
    expect(op).toMatchObject({ op: "group", ids: [a, b] });
    expect(view.selection()).toEqual([a, b]);
    view.socket.ack(sent?.reqId, 2);
    await waitFor(() => expect(view.selection()).toEqual([op.id]));
    view.unmount();
  });

  it("does not select and shows an error toast when the server refuses, and the editor keeps its selection", async () => {
    const user = userEvent.setup();
    const view = await mount();
    const [a, b] = view.ids as [string, string];
    view.select([a, b]);
    await user.click(screen.getByRole("button", { name: "Group" }));
    const reqId = view.socket.lastReqId("ops");
    act(() => view.socket.receive({ type: "error", reqId: reqId as string, message: "node is locked" }));
    expect(await screen.findByText("Could not apply the change")).toBeInTheDocument();
    expect(screen.getByText("node is locked")).toBeInTheDocument();
    expect(view.selection()).toEqual([a, b]);
    view.unmount();
  });

  it("a rejected plain edit (nobody awaits it) is reported too, once", async () => {
    const user = userEvent.setup();
    const view = await mount();
    view.select([view.ids[0] as string]);
    const name = screen.getByRole("textbox", { name: "Name" });
    await user.clear(name);
    await user.type(name, "X{Enter}");
    act(() => view.socket.receive({ type: "error", reqId: view.socket.lastReqId("ops") as string, message: "refused" }));
    expect(await screen.findByText("refused")).toBeInTheDocument();
    expect(screen.getAllByText("Could not apply the change")).toHaveLength(1);
    view.unmount();
  });

  it("says the connection is down when the edit cannot be sent", async () => {
    const user = userEvent.setup();
    const view = await mount();
    view.select([view.ids[0] as string]);
    act(() => view.socket.drop());
    const name = screen.getByRole("textbox", { name: "Name" });
    await user.clear(name);
    await user.type(name, "Y{Enter}");
    expect(await screen.findByText(/Connection lost/)).toBeInTheDocument();
    view.unmount();
  });

  it("says the change may have been applied when the connection dropped after it was sent", async () => {
    const user = userEvent.setup();
    const view = await mount();
    view.select([view.ids[0] as string]);
    const name = screen.getByRole("textbox", { name: "Name" });
    await user.clear(name);
    await user.type(name, "Z{Enter}");
    expect(view.socket.lastReqId("ops")).toBeTruthy();
    act(() => view.socket.drop());
    expect(await screen.findByText(/may have been applied/)).toBeInTheDocument();
    expect(screen.queryByText(/cannot be sent/)).not.toBeInTheDocument();
    expect(screen.getAllByText("Could not apply the change")).toHaveLength(1);
    view.unmount();
  });

  it("hints the group shortcuts the way the platform spells them", async () => {
    const view = await mount();
    const [a, b] = view.ids as [string, string];
    view.select([a, b]);
    expect(screen.getByRole("button", { name: "Group" }).getAttribute("title")).toMatch(/G$/);
    view.unmount();
  });

  it("drops a selected node the server deleted: the panel goes back to the document", async () => {
    const view = await mount();
    const id = view.ids[0] as string;
    view.select([id]);
    const nodes = { ...view.rig.client.store.state.doc!.nodes };
    const parent = nodes[id]!.parentId as string;
    view.rig.deliver({ ...nodeDelta(view.doc, parent, {}, 2), nodes: { del: [id] } });
    expect(await screen.findByTestId("document-panel")).toBeInTheDocument();
    view.unmount();
  });

  it("lists the activity in the document panel: you, the agent, and a step as undone", async () => {
    const view = await mount();
    // The panel lists new entries at most every ACTIVITY_REFRESH_MS: time is the test's, so three edits in a row show after it passes.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    view.rig.deliver(nodeDelta(view.doc, view.ids[0] as string, { x: 1 }, 2, { actor: "user", label: "move" }));
    view.rig.deliver(nodeDelta(view.rig.client.store.state.doc!, view.ids[1] as string, { x: 1 }, 3, { actor: "agent:claude", label: "update_nodes" }));
    view.rig.deliver(nodeDelta(view.rig.client.store.state.doc!, view.ids[1] as string, { x: 2 }, 4, { actor: "user", label: "undo: move", kind: "undo" }));
    act(() => void vi.advanceTimersByTime(ACTIVITY_REFRESH_MS + 20));
    const list = screen.getByRole("list", { name: "Activity" });
    expect(list.textContent).toContain("claude");
    expect(list.textContent).toContain("You");
    expect(list.textContent).toContain("move");
    view.unmount();
  });
});
