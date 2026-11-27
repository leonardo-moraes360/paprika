import { act, render, screen } from "@testing-library/react";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { afterEach, describe, expect, it } from "vitest";
import { dismissToasts, showStatusToast } from "@/lib/notify";
import { RoutedNotifications, TOASTS_EDITOR, TOASTS_OVERVIEW } from "./-routed-notifications";

afterEach(() => dismissToasts());

async function openAt(path: string) {
  const root = createRootRoute({
    component: () => (
      <>
        <Outlet />
        <RoutedNotifications />
      </>
    ),
  });
  const home = createRoute({ getParentRoute: () => root, path: "/", component: () => <p>home</p> });
  const editor = createRoute({ getParentRoute: () => root, path: "/w/$workspaceId", component: () => <p>editor</p> });
  const router = createRouter({ routeTree: root.addChildren([home, editor]), history: createMemoryHistory({ initialEntries: [path] }) });
  render(<RouterProvider router={router} />);
  await screen.findByText(path === "/" ? "home" : "editor");
  act(() => void showStatusToast({ status: "danger", title: "Format not supported" }));
  await screen.findByText("Format not supported");
  return screen.getByRole("region", { name: /notifications/i });
}

describe("toast region", () => {
  it("sits 16 px above the edge on the overview", async () => {
    expect((await openAt("/")).className.split(/\s+/)).toContain(TOASTS_OVERVIEW);
  });

  it("is lifted above the zoom bar while a workspace is open", async () => {
    const classes = (await openAt("/w/abc")).className.split(/\s+/);
    expect(classes).toContain(TOASTS_EDITOR);
    expect(classes).not.toContain(TOASTS_OVERVIEW);
  });
});
