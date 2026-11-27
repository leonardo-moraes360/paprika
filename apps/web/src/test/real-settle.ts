import { act } from "@testing-library/react";
import { SETTLE_MS } from "@/components/frontends/canvas/view-store";

/**
 * Lets the timers that the canvas armed while it mounted run on the REAL clock before a test switches to fake timers.
 * The camera's settle timer (`SETTLE_MS`, 140 ms) is a real `setTimeout` created during the mount; fake timers do not
 * cancel a timer that exists already, so on a loaded machine it would fire in the middle of a case (an `onSettled` that
 * sets the zoom, one more commit after `log.reset()`). A timer created now with a longer delay runs after every older one.
 * Call it after the last `findBy*` of the opening and before `vi.useFakeTimers`.
 */
export async function letRealTimersRun(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, SETTLE_MS + 60));
  });
}
