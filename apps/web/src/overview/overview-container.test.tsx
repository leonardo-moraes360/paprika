import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Notifications } from "@/components/notifications";
import { LiveProvider } from "@/data/live";
import { createLiveRig, type LiveRig } from "@/test/live-harness";
import { createQueryClient } from "@/data/query-client";
import { dismissToasts } from "@/lib/notify";
import { OverviewContainer } from "./overview-container";

const workspace = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  nodes: 12,
  updatedAt: Date.now(),
  active: false,
  cover: null,
  archived: false,
  folderId: "",
  preview: [],
  ...extra,
});

const reply = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

type Handler = (url: string, init?: RequestInit) => Promise<Response>;

function mount(handler: Handler, rig: LiveRig = createLiveRig()) {
  const fetchMock = vi.fn(handler);
  vi.stubGlobal("fetch", fetchMock);
  window.scrollTo = () => {};
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
  return { fetchMock, router, rig, queryClient };
}

afterEach(() => {
  dismissToasts();
  vi.unstubAllGlobals();
});

describe("/ (overview)", () => {
  it("lists the workspaces the server returns", async () => {
    mount((url) => (url.startsWith("/api/workspaces?") || url === "/api/workspaces" ? reply({ active: "a", workspaces: [workspace("a", "Demo Paprika", { active: true }), workspace("b", "Checkout")], folders: [] }) : reply({}, 404)));
    expect(await screen.findByText("Demo Paprika")).toBeInTheDocument();
    expect(screen.getByText("Checkout")).toBeInTheDocument();
  });

  it("opens a workspace: navigates first, then tells the server to make it the active one", async () => {
    const user = userEvent.setup();
    const { fetchMock, router } = mount((url, init) => {
      if (url.startsWith("/api/workspaces?") || url === "/api/workspaces") return reply({ active: "a", workspaces: [workspace("a", "Demo Paprika", { active: true }), workspace("b", "Checkout")], folders: [] });
      if (url === "/api/workspaces/b/open" && init?.method === "POST") return reply({ workspace: workspace("b", "Checkout", { active: true }), version: 3 });
      return reply({}, 404);
    });
    await user.click(await screen.findByRole("button", { name: /Checkout/ }));
    expect(await screen.findByTestId("editor-route")).toHaveTextContent("b");
    expect(router.state.location.pathname).toBe("/w/b");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/workspaces/b/open", expect.objectContaining({ method: "POST" })));
  });

  it("tells the user when the open request is refused, and stays on the editor route", async () => {
    const user = userEvent.setup();
    mount((url) => {
      if (url.startsWith("/api/workspaces?") || url === "/api/workspaces") return reply({ active: "a", workspaces: [workspace("a", "Demo Paprika"), workspace("b", "Checkout")], folders: [] });
      return reply({ error: 'workspace "b" does not exist' }, 404);
    });
    await user.click(await screen.findByRole("button", { name: /Checkout/ }));
    expect(await screen.findByText("Could not open the workspace.")).toBeInTheDocument();
    expect(screen.getByText('workspace "b" does not exist')).toBeInTheDocument();
  });

  it("shows the error state with a retry when the list fails, and loads it on retry", async () => {
    const user = userEvent.setup();
    let failing = true;
    mount((url) => {
      if (!url.startsWith("/api/workspaces?")) return reply({}, 404);
      return failing ? reply({ error: "database is locked" }, 500) : reply({ active: "a", workspaces: [workspace("a", "Back again")], folders: [] });
    });
    expect(await screen.findByText(/database is locked/, {}, { timeout: 4000 })).toBeInTheDocument();
    failing = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Back again")).toBeInTheDocument();
  });
});
