import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OpeningWorkspace } from "./workspace-route";
import { ShellWarmup } from "./shell-warmup";
import { LiveProvider } from "@/data/live";
import { createLiveRig } from "@/test/live-harness";

describe("shell warm-up", () => {
  it("writes the UI SDK's style sheets while the opening state is on screen, and shows and announces nothing of its own", () => {
    const rig = createLiveRig();
    const { container } = render(
      <LiveProvider client={rig.client}>
        <OpeningWorkspace />
      </LiveProvider>,
    );
    // The sheets that used to be written together with the nodes are in place before any node exists.
    expect(document.getElementById("ui-sdk-hidden")).not.toBeNull();
    expect(document.getElementById("ui-sdk-popover-reset")).not.toBeNull();
    // Out of the page: not visible, not in the accessibility tree, not focusable.
    const warm = container.querySelector("[inert]") as HTMLElement;
    expect(warm).not.toBeNull();
    expect(warm.hidden).toBe(true);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("mounts alone", () => {
    const { container } = render(<ShellWarmup />);
    expect(container.querySelector("[hidden]")).not.toBeNull();
  });
});
