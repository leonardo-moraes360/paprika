import { LintRunner, type LintRequest } from "./lintRunner";

const runner = new LintRunner((summary, id) => postMessage({ id, summary }));

self.onmessage = (ev: MessageEvent<LintRequest>) => {
  if (ev.origin !== "" && ev.origin !== self.location.origin) return;
  runner.receive(ev.data);
};
