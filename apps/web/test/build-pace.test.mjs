import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)),
  configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
  server: { middlewareMode: true },
  logLevel: "warn",
});
const { BUILD_STEP_MS, BUILD_TICK_MS, BUILD_WALK_CAP_MS, appendBuild, buildPace, stepBuild } = await server.ssrLoadModule("/src/agents.ts");
after(() => server.close());

const ids = (n, p = "n") => Array.from({ length: n }, (_, i) => `${p}${i}`);

function run(list, from = 0) {
  let now = from;
  let ticks = 0;
  const seen = new Map();
  while (list.length) {
    for (const w of list) seen.set(w.actor, [...(seen.get(w.actor) ?? []), w.ids[w.index]]);
    now += BUILD_TICK_MS;
    list = stepBuild(list, now);
    ticks++;
    assert.ok(ticks < 10_000);
  }
  return { elapsed: now - from, seen };
}

describe("build walk pacing", () => {
  it("keeps the slow step for short queues", () => {
    assert.deepEqual(buildPace(1), { stepMs: BUILD_STEP_MS, stride: 1 });
    assert.deepEqual(buildPace(16), { stepMs: BUILD_STEP_MS, stride: 1 });
  });

  it("speeds up and strides on long queues", () => {
    assert.deepEqual(buildPace(17), { stepMs: BUILD_TICK_MS, stride: 1 });
    assert.deepEqual(buildPace(50), { stepMs: BUILD_TICK_MS, stride: 1 });
    assert.deepEqual(buildPace(200), { stepMs: BUILD_TICK_MS, stride: 4 });
    assert.deepEqual(buildPace(14_752), { stepMs: BUILD_TICK_MS, stride: 296 });
  });

  it("never plans a walk longer than the cap", () => {
    for (const n of [1, 5, 16, 17, 49, 50, 51, 99, 200, 1000, 14_752, 100_000]) {
      const { stepMs, stride } = buildPace(n);
      assert.ok(Math.ceil(n / stride) * stepMs <= BUILD_WALK_CAP_MS, `n=${n}`);
    }
  });

  it("walks 200 nodes in at most the cap and finishes", () => {
    const list = appendBuild([], "agent:a", ids(200), 0);
    const { elapsed, seen } = run(list);
    assert.ok(elapsed <= BUILD_WALK_CAP_MS + BUILD_TICK_MS, `elapsed ${elapsed}`);
    assert.equal(seen.get("agent:a")[0], "n0");
    assert.equal(seen.get("agent:a").length, 50);
  });

  it("catches up after a late tick instead of stretching the walk", () => {
    const list = appendBuild([], "agent:a", ids(200), 0);
    assert.deepEqual(stepBuild(list, 2000), []);
    const mid = stepBuild(list, 1000);
    assert.equal(mid[0].index, 4 * 25);
  });

  it("appending to a running walk restarts the pace of it so the rest still fits the cap", () => {
    let list = appendBuild([], "agent:a", ids(200), 0);
    list = stepBuild(list, 1000);
    list = appendBuild(list, "agent:a", ids(1000, "m"), 1000);
    const { elapsed } = run(list, 1000);
    assert.ok(elapsed <= BUILD_WALK_CAP_MS + BUILD_TICK_MS, `elapsed ${elapsed}`);
  });

  it("ignores ids already queued", () => {
    const list = appendBuild([], "agent:a", ids(3), 0);
    assert.equal(appendBuild(list, "agent:a", ids(3), 5), list);
    assert.equal(appendBuild(list, "agent:a", [], 5), list);
  });

  it("gives each writer its own walk so one does not wait for the other", () => {
    let list = appendBuild([], "agent:a", ids(200, "a"), 0);
    list = stepBuild(list, 1000);
    list = appendBuild(list, "agent:b", ids(10, "b"), 1000);
    assert.equal(list.length, 2);
    assert.equal(list[1].index, 0);
    assert.equal(list[1].nextAt, 1000 + BUILD_STEP_MS);
    const { elapsed, seen } = run(list, 1000);
    assert.equal(seen.get("agent:b")[0], "b0");
    assert.ok(elapsed <= BUILD_WALK_CAP_MS, `elapsed ${elapsed}`);
  });

  it("drops a walk when its queue is done", () => {
    const list = appendBuild([], "agent:a", ids(2), 0);
    assert.equal(stepBuild(list, 0).length, 1);
    assert.equal(stepBuild(list, BUILD_STEP_MS).length, 1);
    assert.equal(stepBuild(list, 2 * BUILD_STEP_MS).length, 0);
  });
});
