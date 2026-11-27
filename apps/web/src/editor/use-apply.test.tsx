import { act, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { dismissToasts } from "@/lib/notify";
import { renderRegions, serve } from "@/test/collab-harness";
import { useApplyOps } from "./use-apply";

afterEach(() => dismissToasts());

let apply: ReturnType<typeof useApplyOps> | null = null;
function Probe() {
  apply = useApplyOps();
  return null;
}

describe("the toast of an action that did not go through", () => {
  it("says the change was not sent when the socket was down, and that it MAY HAVE BEEN APPLIED when the connection dropped with it in flight", async () => {
    const view = await renderRegions({ regions: [["probe", <Probe key="p" />]] });
    serve(view.rig, view.doc);
    const pending = apply!([{ op: "noop" } as never], "x");
    await act(async () => {
      await Promise.resolve();
      view.socket.drop();
      await pending;
    });
    expect(await screen.findByText("Connection lost while sending. The change may have been applied: check before trying again.")).toBeInTheDocument();
    dismissToasts();
    await act(async () => void (await apply!([{ op: "noop" } as never], "y")));
    expect(await screen.findByText("Connection lost. Changes cannot be sent until it is back.")).toBeInTheDocument();
  });
});
