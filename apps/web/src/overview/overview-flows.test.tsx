import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Notifications } from "@/components/notifications";
import { LiveProvider } from "@/data/live";
import { createQueryClient } from "@/data/query-client";
import { dismissToasts } from "@/lib/notify";
import { createLiveRig } from "@/test/live-harness";
import { OverviewContainer } from "./overview-container";

type Row = { id: string; name: string; nodes: number; updatedAt: number; active: boolean; cover: string | null; archived: boolean; folderId: string; preview: unknown[] };

const row = (id: string, name: string, extra: Partial<Row> = {}): Row => ({ id, name, nodes: 12, updatedAt: Date.now(), active: false, cover: null, archived: false, folderId: "", preview: [], ...extra });

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

/** A tiny in-memory server for the routes the overview calls; `requests` keeps what the page sent. */
function fakeServer(initial: { workspaces: Row[]; folders?: { id: string; name: string; updatedAt: number }[] }) {
  const state = { workspaces: [...initial.workspaces], folders: [...(initial.folders ?? [])] };
  const requests: { method: string; url: string; body?: unknown }[] = [];
  const override: Record<string, (init?: RequestInit) => Promise<Response> | undefined> = {};
  const handler = async (url: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
    requests.push({ method, url, body });
    const forced = override[`${method} ${url}`]?.(init);
    if (forced) return forced;
    if (method === "GET" && url.startsWith("/api/workspaces?")) return json({ active: "a", workspaces: state.workspaces, folders: state.folders });
    if (method === "POST" && url === "/api/workspaces") {
      const created = row(`new-${state.workspaces.length}`, body.name);
      state.workspaces = [...state.workspaces, created];
      return json({ workspace: created }, 201);
    }
    if (method === "POST" && url === "/api/folders") {
      const folder = { id: `f${state.folders.length + 1}`, name: body.name, updatedAt: 1 };
      state.folders = [...state.folders, folder];
      return json({ folder }, 201);
    }
    const match = /^\/api\/workspaces\/([^/]+)(?:\/(\w+))?$/.exec(url);
    if (match) {
      const [, id, sub] = match;
      const change = (patch: Partial<Row>) => {
        state.workspaces = state.workspaces.map((w) => (w.id === id ? { ...w, ...patch } : w));
        return json({ workspace: state.workspaces.find((w) => w.id === id) });
      };
      if (method === "PATCH") return change({ name: body.name });
      if (method === "DELETE" && !sub) {
        state.workspaces = state.workspaces.filter((w) => w.id !== id);
        return json({ deleted: id, active: "a" });
      }
      if (method === "POST" && sub === "archive") return change({ archived: true });
      if (method === "POST" && sub === "unarchive") return change({ archived: false });
      if (method === "POST" && sub === "folder") return change({ folderId: body.folderId ?? "" });
      if (method === "POST" && sub === "open") return json({ workspace: state.workspaces[0], version: 1 });
      if (sub === "cover" && method === "PUT") return change({ cover: `/api/workspaces/${id}/cover?v=1` });
      if (sub === "cover" && method === "DELETE") return change({ cover: null });
    }
    return json({ error: "not found" }, 404);
  };
  return { state, requests, override, handler };
}

function mount(server: ReturnType<typeof fakeServer>) {
  vi.stubGlobal("fetch", vi.fn(server.handler));
  window.scrollTo = () => {};
  const rig = createLiveRig();
  const queryClient = createQueryClient();
  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <LiveProvider client={rig.client}>
          <Outlet />
          <Notifications />
        </LiveProvider>
      </QueryClientProvider>
    ),
  });
  const home = createRoute({ getParentRoute: () => root, path: "/", component: OverviewContainer });
  const editor = createRoute({ getParentRoute: () => root, path: "/w/$workspaceId", component: () => <div data-testid="editor-route">{editor.useParams().workspaceId}</div> });
  const router = createRouter({ routeTree: root.addChildren([home, editor]), history: createMemoryHistory({ initialEntries: ["/"] }) });
  render(<RouterProvider router={router} />);
  return { rig, router, queryClient };
}

const card = (id: string) => document.querySelector(`li[data-workspace-id="${id}"]`) as HTMLElement;
const openMenu = async (user: ReturnType<typeof userEvent.setup>, id: string) => user.click(within(card(id)).getByRole("button", { name: "More actions" }));
const sent = (server: ReturnType<typeof fakeServer>, method: string, url: string) => server.requests.filter((r) => r.method === method && r.url === url);
const listCalls = (server: ReturnType<typeof fakeServer>) => server.requests.filter((r) => r.method === "GET" && r.url.startsWith("/api/workspaces?")).length;

afterEach(() => {
  dismissToasts();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("/ against the server's routes", () => {
  it("asks the socket for the active workspace on arrival, so the list follows it and not the last workspace seen", async () => {
    const server = fakeServer({ workspaces: [row("a", "Demo", { active: true }), row("b", "Checkout")] });
    const { rig, router } = mount(server);
    await screen.findByText("Demo");
    const socket = await rig.connect();
    expect(socket.sentOf("view")).toEqual([{ type: "view", reqId: expect.any(String) }]);
    await act(async () => void (await router.navigate({ to: "/w/$workspaceId", params: { workspaceId: "b" } })));
    void rig.client.view("b").catch(() => {});
    expect(rig.sockets.last.sentOf("view").at(-1)).toMatchObject({ workspaceId: "b" });
    await act(async () => void (await router.navigate({ to: "/" })));
    await screen.findByText("Demo");
    expect(rig.sockets.last.sentOf("view").at(-1)).toEqual({ type: "view", reqId: expect.any(String) });
  });

  it("asks for active and archived workspaces in one list and filters by view", async () => {
    const user = userEvent.setup();
    const server = fakeServer({ workspaces: [row("a", "Demo", { active: true }), row("b", "Checkout"), row("c", "Old brand", { archived: true })] });
    mount(server);
    expect(await screen.findByText("Demo")).toBeInTheDocument();
    expect(server.requests[0]?.url).toBe("/api/workspaces?includeArchived=1");
    expect(screen.queryByText("Old brand", { selector: "button *, button" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Archived/ }));
    expect(await screen.findByRole("button", { name: /Old brand/ })).toBeInTheDocument();
  });

  it("creates a workspace and opens it (navigates, then POST /open)", async () => {
    const user = userEvent.setup();
    const server = fakeServer({ workspaces: [row("a", "Demo", { active: true })] });
    const { router } = mount(server);
    await user.click(await screen.findByRole("button", { name: "New workspace" }));
    await user.keyboard("Brand book{Enter}");
    expect(await screen.findByTestId("editor-route")).toHaveTextContent("new-1");
    expect(sent(server, "POST", "/api/workspaces")[0]?.body).toEqual({ name: "Brand book" });
    await waitFor(() => expect(sent(server, "POST", "/api/workspaces/new-1/open")).toHaveLength(1));
    expect(router.state.location.pathname).toBe("/w/new-1");
  });

  it("renames optimistically: the new name shows before the server answers, and the server's name wins after", async () => {
    const user = userEvent.setup();
    const server = fakeServer({ workspaces: [row("a", "Demo", { active: true }), row("b", "Checkout")] });
    let release: (r: Response) => void = () => {};
    server.override["PATCH /api/workspaces/b"] = () => new Promise<Response>((resolve) => (release = resolve));
    mount(server);
    await screen.findByText("Checkout");
    await openMenu(user, "b");
    await user.click(screen.getByRole("menuitem", { name: /^Rename/ }));
    const input = await within(card("b")).findByRole("textbox");
    await user.clear(input);
    await user.type(input, "Payments{Enter}");
    expect(await screen.findByText("Payments")).toBeInTheDocument();
    expect(screen.queryByText("Checkout")).not.toBeInTheDocument();
    expect(sent(server, "PATCH", "/api/workspaces/b")[0]?.body).toEqual({ name: "Payments" });
    server.state.workspaces = server.state.workspaces.map((w) => (w.id === "b" ? { ...w, name: "Payments (server)" } : w));
    await act(async () => release(await json({ workspace: server.state.workspaces[1] })));
    expect(await screen.findByText("Payments (server)")).toBeInTheDocument();
  });

  it("deletes after typing the name, and shows the server's 409 when it refuses", async () => {
    const user = userEvent.setup();
    const server = fakeServer({ workspaces: [row("a", "Demo", { active: true }), row("b", "Checkout")] });
    server.override["DELETE /api/workspaces/b"] = () => json({ error: "cannot delete the only workspace" }, 409);
    mount(server);
    await screen.findByText("Checkout");
    await openMenu(user, "b");
    await user.click(screen.getByRole("menuitem", { name: /^Delete/ }));
    await user.type(await screen.findByRole("textbox"), "Checkout");
    await user.click(screen.getByRole("button", { name: /^Delete/ }));
    expect(await screen.findByText(/cannot delete the only workspace/)).toBeInTheDocument();
    expect(card("b")).toBeTruthy();
    delete server.override["DELETE /api/workspaces/b"];
    await openMenu(user, "b");
    await user.click(screen.getByRole("menuitem", { name: /^Delete/ }));
    await user.type(await screen.findByRole("textbox"), "Checkout");
    await user.click(screen.getByRole("button", { name: /^Delete/ }));
    await waitFor(() => expect(card("b")).toBeNull());
    expect(sent(server, "DELETE", "/api/workspaces/b").length).toBeGreaterThan(0);
  });

  it("does not offer to delete or archive the last workspace that is not archived", async () => {
    const user = userEvent.setup();
    mount(fakeServer({ workspaces: [row("a", "Demo", { active: true }), row("c", "Old", { archived: true })] }));
    await screen.findByText("Demo");
    await openMenu(user, "a");
    expect(screen.getByRole("menuitem", { name: /^Delete/ })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("menuitem", { name: "Archive" })).toHaveAttribute("aria-disabled", "true");
  });

  it("archives and restores", async () => {
    const user = userEvent.setup();
    const server = fakeServer({ workspaces: [row("a", "Demo", { active: true }), row("b", "Checkout")] });
    mount(server);
    await screen.findByText("Checkout");
    await openMenu(user, "b");
    await user.click(screen.getByRole("menuitem", { name: "Archive" }));
    await waitFor(() => expect(sent(server, "POST", "/api/workspaces/b/archive")).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Checkout/ })).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /^Archived/ }));
    await openMenu(user, "b");
    await user.click(screen.getByRole("menuitem", { name: "Restore" }));
    await waitFor(() => expect(sent(server, "POST", "/api/workspaces/b/unarchive")).toHaveLength(1));
  });

  it("sends a small supported image as it is and removes the cover with DELETE", async () => {
    const user = userEvent.setup();
    const server = fakeServer({ workspaces: [row("a", "Demo", { active: true }), row("b", "Checkout")] });
    mount(server);
    await screen.findByText("Checkout");
    await openMenu(user, "b");
    await user.click(screen.getByRole("menuitem", { name: "Add cover" }));
    const file = new File(["x"], "cover.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Cover image", { selector: "input" }), { target: { files: [file] } });
    await waitFor(() => expect(sent(server, "PUT", "/api/workspaces/b/cover")).toHaveLength(1));
    expect(sent(server, "PUT", "/api/workspaces/b/cover")[0]?.body).toBe(file);
    await waitFor(() => expect(card("b").querySelector("img")).toHaveAttribute("src", "/api/workspaces/b/cover?v=1"));
    await openMenu(user, "b");
    await user.click(screen.getByRole("menuitem", { name: "Remove cover" }));
    await waitFor(() => expect(sent(server, "DELETE", "/api/workspaces/b/cover")).toHaveLength(1));
  });

  it("creates a project (a folder) from the sidebar and moves a workspace into it", async () => {
    const user = userEvent.setup();
    const server = fakeServer({ workspaces: [row("a", "Demo", { active: true }), row("b", "Checkout")] });
    mount(server);
    await screen.findByText("Checkout");
    await user.click(screen.getByRole("button", { name: "New project" }));
    await user.keyboard("Studio{Enter}");
    await waitFor(() => expect(sent(server, "POST", "/api/folders")[0]?.body).toEqual({ name: "Studio" }));
    expect(await screen.findByRole("button", { name: /Studio/ })).toBeInTheDocument();
    await openMenu(user, "b");
    await user.click(screen.getByRole("menuitemradio", { name: "Studio" }));
    await waitFor(() => expect(sent(server, "POST", "/api/workspaces/b/folder")[0]?.body).toEqual({ folderId: "f1" }));
  });

  it("shows a failed creation of a project and keeps the field", async () => {
    const user = userEvent.setup();
    const server = fakeServer({ workspaces: [row("a", "Demo", { active: true })] });
    server.override["POST /api/folders"] = () => json({ error: "name cannot be blank" }, 400);
    mount(server);
    await screen.findByText("Demo");
    await user.click(screen.getByRole("button", { name: "New project" }));
    await user.keyboard("X{Enter}");
    expect(await screen.findByText(/Could not create the project: name cannot be blank/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "New project name" })).toBeInTheDocument();
  });

  it("searches locally, without asking the server again", async () => {
    const user = userEvent.setup();
    const server = fakeServer({ workspaces: [row("a", "Demo", { active: true }), row("b", "Checkout")] });
    mount(server);
    await screen.findByText("Checkout");
    const before = server.requests.length;
    await user.type(screen.getByRole("searchbox", { name: "Search workspaces" }), "check");
    expect(screen.queryByRole("button", { name: /Demo/ })).not.toBeInTheDocument();
    await user.type(screen.getByRole("searchbox", { name: "Search workspaces" }), "zzz");
    expect(await screen.findByText("No workspaces match your search.")).toBeInTheDocument();
    expect(server.requests.length).toBe(before);
  });

  it("shows the empty state when there is no workspace at all", async () => {
    mount(fakeServer({ workspaces: [] }));
    expect(await screen.findByText(/No workspaces yet|empty|Create your first/i)).toBeInTheDocument();
  });

  it("refetches the list when anyone creates, renames or deletes a workspace, and shows an agent's notice", async () => {
    const server = fakeServer({ workspaces: [row("a", "Demo", { active: true }), row("b", "Checkout")] });
    const { rig } = mount(server);
    await screen.findByText("Checkout");
    await rig.connect();
    const before = listCalls(server);
    server.state.workspaces = server.state.workspaces.filter((w) => w.id !== "b");
    rig.push({ type: "workspaceOp", op: { at: 1, actor: "agent:claude", op: "delete", workspaceId: "b", workspaceName: "Checkout", detail: { nodes: 12, pages: 1 } } });
    await waitFor(() => expect(listCalls(server)).toBe(before + 1));
    await waitFor(() => expect(screen.queryByText("Checkout", { selector: "button *, button" })).not.toBeInTheDocument());
    expect(await screen.findByText("claude")).toBeInTheDocument();
    expect(screen.getByText("12 nodes · 1 page")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Dismiss notice" }));
    await waitFor(() => expect(screen.queryByText("claude")).not.toBeInTheDocument());
  });

  it("a user's own workspaceOp refetches the list but shows no notice", async () => {
    const server = fakeServer({ workspaces: [row("a", "Demo", { active: true })] });
    const { rig } = mount(server);
    await screen.findByText("Demo");
    await rig.connect();
    const before = listCalls(server);
    rig.push({ type: "workspaceOp", op: { at: 1, actor: "user", op: "rename", workspaceId: "a", workspaceName: "Demo", detail: {} } });
    await waitFor(() => expect(listCalls(server)).toBe(before + 1));
    expect(screen.queryByRole("button", { name: "Dismiss notice" })).not.toBeInTheDocument();
  });
});
