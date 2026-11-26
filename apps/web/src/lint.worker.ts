import { LintRunner, type LintRequest } from "./lintRunner";

const runner = new LintRunner((summary, id) => postMessage({ id, summary }));

self.onmessage = (ev: MessageEvent<LintRequest>) => runner.receive(ev.data);
