import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveProvider } from "@/data/live";
import { createLiveRig, docMessage, makeDocument, nodeDelta } from "@/test/live-harness";
import type { TransportFactory } from "./doc-lint";
import type { LintRequest } from "./lint-runner";
import { DocLintTransportProvider, useDocLint } from "./use-doc-lint";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function Probe({ enabled }: { enabled: boolean }) {
  useDocLint(enabled);
  return null;
}

describe("useDocLint feeding", () => {
  it("feeds the lint only while it is enabled, and brings it up to date when it comes back on", async () => {
    const posted: LintRequest[] = [];
    const transport: TransportFactory = () => ({ post: (request) => void posted.push(request), close: () => {} });
    const rig = createLiveRig();
    const doc = makeDocument(200);
    const tree = (enabled: boolean) => (
      <LiveProvider client={rig.client}>
        <DocLintTransportProvider transport={transport}>
          <Probe enabled={enabled} />
        </DocLintTransportProvider>
      </LiveProvider>
    );
    const view = render(tree(true));
    await rig.connect();
    rig.deliver(docMessage(doc, 1));
    act(() => void vi.advanceTimersByTime(2000));
    expect(posted.map((request) => request.type)).toEqual(["reset"]);

    view.rerender(tree(false));
    const ids = Object.keys(doc.nodes);
    for (let i = 0; i < 20; i += 1) {
      rig.deliver(nodeDelta(rig.client.store.state.doc!, ids[10 + i] as string, { x: i }, 2 + i));
      act(() => void vi.advanceTimersByTime(150));
    }
    // 20 edits while disabled: nothing was diffed or posted.
    expect(posted).toHaveLength(1);

    view.rerender(tree(true));
    act(() => void vi.advanceTimersByTime(150));
    expect(posted).toHaveLength(2);
    expect(posted[1]?.type).toBe("patch");
    view.unmount();
  });

  it("shows what it has sent on window.__paprikaLint with ?e2e=1, and takes it away on unmount", async () => {
    window.history.replaceState(null, "", "/?e2e=1");
    const transport: TransportFactory = () => ({ post: () => {}, close: () => {} });
    const rig = createLiveRig();
    const view = render(
      <LiveProvider client={rig.client}>
        <DocLintTransportProvider transport={transport}>
          <Probe enabled />
        </DocLintTransportProvider>
      </LiveProvider>,
    );
    await rig.connect();
    rig.deliver(docMessage(makeDocument(50), 1));
    act(() => void vi.advanceTimersByTime(2000));
    expect((window as unknown as { __paprikaLint: unknown }).__paprikaLint).toEqual({ posts: 1, resets: 1, patchedNodes: 0 });
    view.unmount();
    expect("__paprikaLint" in window).toBe(false);
    window.history.replaceState(null, "", "/");
  });

  it("does not expose window.__paprikaLint without ?perf=1 or ?e2e=1", async () => {
    const transport: TransportFactory = () => ({ post: () => {}, close: () => {} });
    const rig = createLiveRig();
    const view = render(
      <LiveProvider client={rig.client}>
        <DocLintTransportProvider transport={transport}>
          <Probe enabled />
        </DocLintTransportProvider>
      </LiveProvider>,
    );
    await rig.connect();
    expect("__paprikaLint" in window).toBe(false);
    view.unmount();
  });
});
