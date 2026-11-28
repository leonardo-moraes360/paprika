import { LintRunner, type LintRequest } from "./lint-runner";

const runner = new LintRunner((summary, id) => postMessage({ id, summary }));

self.onmessage = (event: MessageEvent<LintRequest>) => {
  if (event.origin !== "" && event.origin !== self.location.origin) return;
  runner.receive(event.data);
};
