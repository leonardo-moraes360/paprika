import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveProvider } from "@/data/live/hooks";
import { createQueryClient } from "@/data/query-client";
import { createLiveRig, makeDocument, docMessage } from "@/test/live-harness";
import { EditorProvider, initialEditorState } from "../editor-store";
import { EditorBoundary, issueTarget } from "./boundary";

afterEach(() => vi.restoreAllMocks());

function Bomb({ explode }: { explode: boolean }) {
  if (explode) throw new Error("Cannot read properties of undefined (reading 'children')");
  return <p>editor is fine</p>;
}

async function setup(explode: boolean) {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const rig = createLiveRig();
  await rig.connect();
  rig.deliver(docMessage(makeDocument(5, { id: "w-1" }), 1));
  const view = render(
    <QueryClientProvider client={createQueryClient()}>
      <LiveProvider client={rig.client}>
        <EditorProvider initial={initialEditorState}>
          <EditorBoundary>
            <Bomb explode={explode} />
          </EditorBoundary>
        </EditorProvider>
      </LiveProvider>
    </QueryClientProvider>,
  );
  return { rig, ...view };
}

describe("EditorBoundary", () => {
  it("renders the editor when nothing throws", async () => {
    await setup(false);
    expect(screen.getByText("editor is fine")).toBeInTheDocument();
  });

  it("shows the recovery screen with the project's repository for the report, details collapsed, and reloads on demand", async () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    await setup(true);
    expect(screen.getByRole("heading", { name: /canvas stopped responding/i })).toBeInTheDocument();
    const report = screen.getByRole("link", { name: /report on github/i });
    expect(report.getAttribute("href")).toContain(`https://github.com/${issueTarget.repository}/issues/new`);
    expect(decodeURIComponent((report.getAttribute("href") ?? "").replace(/\+/g, " "))).toContain("Paprika web app · renderer dom");
    await userEvent.setup().click(screen.getByRole("button", { name: /reload/i }));
    expect(reload).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("starts clean when the workspace changes (resetKey)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const rig = createLiveRig();
    await rig.connect();
    rig.deliver(docMessage(makeDocument(5, { id: "w-1" }), 1));
    function Harness() {
      const [explode, setExplode] = useState(true);
      return (
        <>
          <button onClick={() => setExplode(false)}>fix</button>
          <EditorBoundary>
            <Bomb explode={explode} />
          </EditorBoundary>
        </>
      );
    }
    render(
      <QueryClientProvider client={createQueryClient()}>
        <LiveProvider client={rig.client}>
          <EditorProvider initial={initialEditorState}>
            <Harness />
          </EditorProvider>
        </LiveProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("heading", { name: /canvas stopped responding/i })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "fix" }));
    expect(screen.getByRole("heading", { name: /canvas stopped responding/i })).toBeInTheDocument();
    rig.deliver(docMessage(makeDocument(5, { id: "w-2" }), 1));
    await act(async () => {});
    expect(screen.getByText("editor is fine")).toBeInTheDocument();
  });
});
