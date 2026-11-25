import type { Page } from "playwright";

let rpcId = 0;

export async function mcp(base: string, name: string, args: Record<string, unknown>, agent = "perf") {
  const started = performance.now();
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "user-agent": `${agent}/1.0` },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }),
  });
  const body = (await res.json()) as { result?: { isError?: boolean; content: { text: string }[]; structuredContent?: any } };
  if (!body.result || body.result.isError) throw new Error(`${name}: ${body.result?.content?.[0]?.text ?? JSON.stringify(body)}`);
  return { ms: performance.now() - started, result: body.result };
}

export const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1] ?? 0;
};

export const percentile = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0;
};

export async function instrument(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    w.__long = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__long.push(e.duration);
    }).observe({ entryTypes: ["longtask"] });
    w.__startFrames = () => {
      const deltas: number[] = [];
      let last = performance.now();
      let stop = false;
      w.__framesDone = new Promise<number[]>((resolve) => {
        w.__stopFrames = () => {
          stop = true;
          resolve(deltas);
        };
      });
      const tick = (t: number) => {
        deltas.push(t - last);
        last = t;
        if (!stop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
  });
}

export async function measureFrames(page: Page, gesture: () => Promise<void>) {
  await page.evaluate(() => (window as any).__startFrames());
  await gesture();
  const deltas = await page.evaluate(() => {
    (window as any).__stopFrames();
    return (window as any).__framesDone as Promise<number[]>;
  });
  const d = deltas.slice(1);
  return { frames: d.length, p95: percentile(d, 0.95), max: Math.max(0, ...d) };
}

export async function longTasks(page: Page, action: () => Promise<void>) {
  await page.evaluate(() => ((window as any).__long = []));
  await action();
  const durations = await page.evaluate(() => (window as any).__long as number[]);
  return { count: durations.length, maxMs: Math.max(0, ...durations) };
}

export async function cdpDelta<T>(page: Page, action: () => Promise<T>) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const read = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  const before = await read();
  await action();
  const after = await read();
  await cdp.detach().catch(() => undefined);
  const ms = (k: string) => Math.round(((after[k] ?? 0) - (before[k] ?? 0)) * 1000);
  return { scriptMs: ms("ScriptDuration"), layoutMs: ms("LayoutDuration"), styleMs: ms("RecalcStyleDuration"), taskMs: ms("TaskDuration") };
}
