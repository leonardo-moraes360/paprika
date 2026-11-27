import { describe, expect, it, vi } from "vitest";
import { SETTLE_MS } from "@/components/frontends/canvas/view-store";
import { letRealTimersRun } from "./real-settle";

describe("letRealTimersRun", () => {
  it("runs a real timer of SETTLE_MS that was armed before, even when the thread was busy past its deadline", async () => {
    const settled = vi.fn();
    setTimeout(settled, SETTLE_MS);
    // A loaded machine: the thread is busy past the deadline of the timer and of whatever is armed next.
    const until = Date.now() + SETTLE_MS + 30;
    while (Date.now() < until);
    expect(settled).not.toHaveBeenCalled();
    await letRealTimersRun();
    expect(settled).toHaveBeenCalledTimes(1);
  });
});
