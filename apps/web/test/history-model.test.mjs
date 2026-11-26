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
const model = await server.ssrLoadModule("/src/historyModel.ts");
const toast = await server.ssrLoadModule("/src/lib/toast.ts");
const { catalogs } = await server.ssrLoadModule("/src/i18n/messages.ts");
after(() => server.close());

const step = (id, actor, label, extra = {}) => ({ id, actor, label, at: 1000 + id, ops: 1, undone: false, nodeIds: [], ...extra });

const text = (m) => ({
  you: m.historyYou,
  refazer: m.toastRedo,
  viewHistory: m.toastViewHistory,
  undone: m.toastUndone,
  undoneOwn: m.toastUndoneOwn,
  undoneAgent: m.toastUndoneAgent,
  redone: m.toastRedone,
  nothingMine: m.toastNothingMine,
  nothingAtAll: m.toastNothingAtAll,
  nothingToRedo: m.toastNothingToRedo,
  conflictUndo: m.toastConflictUndo,
  conflictRedo: m.toastConflictRedo,
  missing: m.toastMissing,
});

const res = (over) => ({ result: "undone", ord: 7, label: "Mudar cor do Botão", actor: "user", newer: 0, withActor: "", withLabel: "", ...over });

describe("history grouping", () => {
  it("groups consecutive steps by author, newest first", () => {
    const steps = [step(1, "user", "a"), step(2, "user", "b"), step(3, "agent:codex", "c"), step(4, "agent:claude", "d"), step(5, "agent:claude", "e"), step(6, "user", "f")];
    const groups = model.groupSteps(steps);
    assert.deepEqual(
      groups.map((g) => [g.actor, g.steps.map((s) => s.label)]),
      [
        ["user", ["f"]],
        ["agent:claude", ["e", "d"]],
        ["agent:codex", ["c"]],
        ["user", ["b", "a"]],
      ],
    );
    assert.equal(groups[0].newestAt, 1006);
  });

  it("flattens to a header followed by its steps", () => {
    const rows = model.flattenGroups(model.groupSteps([step(1, "user", "a"), step(2, "agent:x", "b")]));
    assert.deepEqual(rows.map((r) => r.kind), ["header", "step", "header", "step"]);
  });

  it("filters to the human's steps only", () => {
    const steps = [step(1, "user", "a"), step(2, "agent:x", "b"), step(3, "user", "c")];
    assert.deepEqual(model.filterSteps(steps, true).map((s) => s.id), [1, 3]);
    assert.equal(model.filterSteps(steps, false).length, 3);
  });

  it("handles 500 steps", () => {
    const steps = Array.from({ length: 500 }, (_, i) => step(i + 1, i % 3 === 0 ? "user" : "agent:a", `s${i}`));
    assert.equal(model.flattenGroups(model.groupSteps(steps)).length, 500 + model.groupSteps(steps).length);
  });
});

describe("names, colours and time", () => {
  it("names the human and agents", () => {
    assert.equal(model.actorName("user", "você"), "você");
    assert.equal(model.actorName("agent:claude", "você"), "claude");
    assert.equal(model.actorName("api", "você"), "api");
  });

  it("gives agents a colour and the human none", () => {
    assert.equal(model.actorColor("user", []), null);
    assert.equal(model.actorColor("agent:x", [{ actor: "agent:x", color: "#123456" }]), "#123456");
    assert.match(model.actorColor("agent:y", []), /^#[0-9a-f]{6}$/);
    assert.equal(model.actorColor("agent:y", []), model.actorColor("agent:y", []));
  });

  it("formats relative time", () => {
    assert.equal(model.relativeTime(1000, 1000, "agora"), "agora");
    assert.equal(model.relativeTime(0, 20_000, "agora"), "20 s");
    assert.equal(model.relativeTime(0, 180_000, "agora"), "3 min");
    assert.equal(model.relativeTime(0, 7_200_000, "agora"), "2 h");
    assert.equal(model.relativeTime(0, 3 * 86_400_000, "agora"), "3 d");
  });
});

describe("toast for a step result", () => {
  const pt = text(catalogs["pt-BR"]);
  const handlers = (calls) => ({ redoStep: (id) => calls.push(["redo", id]), openHistory: () => calls.push(["history"]) });

  it("B1: own step on top", () => {
    const calls = [];
    const t = model.toastForStep(res({}), false, pt, handlers(calls), { own: true });
    assert.equal(t.message, "Desfeito: Mudar cor do Botão");
    assert.equal(t.action.label, "Refazer");
    assert.deepEqual(t.hint, ["Ctrl", "Y"]);
    t.action.run();
    assert.deepEqual(calls, [["redo", 7]]);
  });

  it("B2: agent steps kept", () => {
    const t = model.toastForStep(res({ label: "Mover “Título”", newer: 3 }), false, pt, handlers([]), { own: true });
    assert.equal(t.message, "Desfeito o seu passo: Mover “Título”. 3 passos de agentes mais recentes foram mantidos.");
  });

  it("B3: nothing of the human to undo", () => {
    const calls = [];
    const t = model.toastForStep(res({ result: "nothing", actor: "agent:claude", label: "Alinhar botões" }), false, pt, handlers(calls), { own: true });
    assert.equal(t.message, "Nada seu para desfazer. Os últimos passos são de claude.");
    assert.equal(t.action.label, "Ver histórico");
    t.action.run();
    assert.deepEqual(calls, [["history"]]);
  });

  it("nothing at all and nothing to redo have no history action", () => {
    assert.equal(model.toastForStep(res({ result: "nothing", actor: "" }), false, pt, handlers([]), { own: true }).action, undefined);
    assert.equal(model.toastForStep(res({ result: "nothing", actor: "x" }), true, pt, handlers([]), { own: true }).message, "Nada para refazer.");
  });

  it("conflict offers the history", () => {
    const t = model.toastForStep(res({ result: "conflict" }), false, pt, handlers([]), { own: true });
    assert.equal(t.message, "Não dá para desfazer só este passo: passos mais recentes mexeram nos mesmos elementos.");
    assert.equal(t.action.label, "Ver histórico");
    assert.match(model.toastForStep(res({ result: "conflict" }), true, pt, handlers([]), { own: true }).message, /refazer/);
  });

  it("undoing an agent step from the panel names the agent", () => {
    const t = model.toastForStep(res({ actor: "agent:claude", label: "Alinhar botões" }), false, pt, handlers([]), { own: false });
    assert.equal(t.message, "Desfeito o passo do claude: Alinhar botões");
  });

  it("redone and missing", () => {
    assert.equal(model.toastForStep(res({ result: "redone" }), true, pt, handlers([]), { own: true }).message, "Refeito: Mudar cor do Botão");
    assert.equal(model.toastForStep(res({ result: "missing" }), false, pt, handlers([]), { own: false }).message, "Esse passo não está mais no histórico.");
  });

  it("english catalog covers the same keys", () => {
    const en = text(catalogs.en);
    assert.equal(model.toastForStep(res({}), false, en, handlers([]), { own: true }).message, "Undone: Mudar cor do Botão");
    assert.equal(model.toastForStep(res({ newer: 1 }), false, en, handlers([]), { own: true }).message, "Undone your step: Mudar cor do Botão. 1 newer step by an agent was kept.");
  });
});

describe("page of a step's nodes", () => {
  const nodes = {
    p1: { type: "page" },
    p2: { type: "page" },
    a: { type: "frame", parentId: "p1" },
    b: { type: "rect", parentId: "a" },
    c: { type: "rect", parentId: "p2" },
  };
  it("keeps the nodes on the first node's page", () => {
    assert.deepEqual(model.pageOfNodes(nodes, ["b", "c", "gone"]), { ids: ["b"], pageId: "p1" });
    assert.deepEqual(model.pageOfNodes(nodes, ["gone"]), { ids: [], pageId: null });
    assert.deepEqual(model.pageOfNodes(nodes, ["p1"]), { ids: [], pageId: null });
  });
});

describe("toast store", () => {
  it("shows one toast at a time and dismisses by id", () => {
    const a = toast.showToast({ message: "a" });
    const b = toast.showToast({ message: "b" });
    assert.equal(toast.currentToast().message, "b");
    toast.dismissToast(a);
    assert.equal(toast.currentToast().id, b);
    toast.dismissToast(b);
    assert.equal(toast.currentToast(), null);
    assert.equal(toast.TOAST_MS, 6000);
  });
});
