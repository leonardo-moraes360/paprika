import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { HistoryPanel, type HistoryAuthor, type HistoryPanelProps, type HistoryStepData } from "./index";

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 400 });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 360 });
});

const NOW = 5_000_000;
const you: HistoryAuthor = { id: "user", name: "you", agent: false };
const claude: HistoryAuthor = { id: "agent:claude", name: "claude", agent: true, tone: "agent-1" };
const codex: HistoryAuthor = { id: "agent:codex", name: "codex", agent: true, tone: "agent-2" };

const step = (id: string, author: HistoryAuthor, label: string, ago: number, extra: Partial<HistoryStepData> = {}): HistoryStepData => ({
  id,
  author,
  label,
  at: NOW - ago,
  undone: false,
  nodeIds: [`n${id}`],
  ...extra,
});

const steps: HistoryStepData[] = [
  step("1", you, "Change Button color", 4 * 60_000, { undone: true }),
  step("2", you, "Move Title", 3 * 60_000),
  step("3", codex, "Rename layers", 2 * 60_000),
  step("4", claude, "Import icons", 60_000),
  step("5", claude, "Create card Plan", 20_000),
  step("6", claude, "Align buttons", 1_000),
];

function setup(props: Partial<HistoryPanelProps> = {}) {
  const handlers = {
    onUndoStep: vi.fn(() => Promise.resolve()),
    onRedoStep: vi.fn(() => Promise.resolve()),
    onSelectNodes: vi.fn(),
    onClose: vi.fn(),
  };
  const view = render(<HistoryPanel steps={steps} now={NOW} {...handlers} {...props} />);
  return { ...handlers, ...props, ...view } as typeof handlers & typeof view;
}

const rowOf = (label: RegExp) => screen.getByRole("button", { name: label }).closest("[data-step-id]") as HTMLElement;

describe("HistoryPanel", () => {
  it("groups the steps by author, newest first", () => {
    setup();
    expect(screen.getByRole("region", { name: "History" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["claude3 steps · now", "codex1 step · 2 min", "you2 steps · 3 min"]);
    expect(Array.from(document.querySelectorAll("[data-step-id]")).map((el) => el.getAttribute("data-step-id"))).toEqual(["6", "5", "4", "3", "2", "1"]);
  });

  it("marks undone steps", () => {
    setup();
    expect(rowOf(/^Change Button color/)).toHaveAttribute("data-undone", "true");
    expect(within(rowOf(/^Change Button color/)).getByText("undone")).toBeInTheDocument();
  });

  it("shows only my steps with the filter and reports it", async () => {
    const user = userEvent.setup();
    const onMineOnlyChange = vi.fn();
    setup({ onMineOnlyChange });
    await user.click(screen.getByRole("radio", { name: "Mine only" }));
    expect(onMineOnlyChange).toHaveBeenCalledWith(true);
    expect(document.querySelectorAll("[data-step-id]")).toHaveLength(2);
    expect(screen.queryByText("Align buttons")).not.toBeInTheDocument();
  });

  it("follows a controlled filter", async () => {
    const user = userEvent.setup();
    setup({ mineOnly: false });
    await user.click(screen.getByRole("radio", { name: "Mine only" }));
    expect(document.querySelectorAll("[data-step-id]")).toHaveLength(6);
  });

  it("shows an empty message and the one for my steps", async () => {
    const user = userEvent.setup();
    setup({ steps: [step("6", claude, "Align", 0)] });
    await user.click(screen.getByRole("radio", { name: "Mine only" }));
    expect(screen.getByText("You have no steps yet.")).toBeInTheDocument();
  });

  it("shows the empty message without steps", () => {
    setup({ steps: [] });
    expect(screen.getByText("No steps yet.")).toBeInTheDocument();
  });

  it("selects the nodes of the step on click", async () => {
    const user = userEvent.setup();
    const { onSelectNodes } = setup();
    await user.click(screen.getByRole("button", { name: /^Move Title/ }));
    expect(onSelectNodes).toHaveBeenCalledWith(["n2"], "2");
  });

  it("does not select when the step has no nodes", async () => {
    const user = userEvent.setup();
    const { onSelectNodes } = setup({ steps: [step("9", you, "Empty", 0, { nodeIds: [] })] });
    await user.click(screen.getByRole("button", { name: /^Empty/ }));
    expect(onSelectNodes).not.toHaveBeenCalled();
  });

  it("undoes my own step straight from the menu", async () => {
    const user = userEvent.setup();
    const { onUndoStep } = setup();
    await user.click(screen.getByRole("button", { name: "Actions for step Move Title" }));
    await user.click(await screen.findByRole("menuitem", { name: "Undo this step" }));
    expect(onUndoStep).toHaveBeenCalledWith("2");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("offers redo for an undone step", async () => {
    const user = userEvent.setup();
    const { onRedoStep } = setup();
    await user.click(screen.getByRole("button", { name: "Actions for step Change Button color" }));
    await user.click(await screen.findByRole("menuitem", { name: "Redo this step" }));
    expect(onRedoStep).toHaveBeenCalledWith("1");
  });

  it("asks for confirmation before undoing an agent step and keeps the focus on its menu", async () => {
    const user = userEvent.setup();
    const { onUndoStep } = setup();
    const trigger = screen.getByRole("button", { name: "Actions for step Align buttons" });
    await user.click(trigger);
    await user.click(await screen.findByRole("menuitem", { name: "Undo this step" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Undo a step by claude?");
    expect(dialog).toHaveTextContent("“Align buttons” was made by the agent claude a few seconds ago.");
    expect(onUndoStep).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Undo step" }));
    expect(onUndoStep).toHaveBeenCalledWith("6");
    await act(async () => {});
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("cancels the confirmation without undoing", async () => {
    const user = userEvent.setup();
    const { onUndoStep } = setup();
    await user.click(screen.getByRole("button", { name: "Actions for step Align buttons" }));
    await user.click(await screen.findByRole("menuitem", { name: "Undo this step" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    expect(onUndoStep).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("shows the error when undoing fails", async () => {
    const user = userEvent.setup();
    setup({ onUndoStep: vi.fn(() => Promise.reject(new Error("conflict"))) });
    await user.click(screen.getByRole("button", { name: "Actions for step Move Title" }));
    await user.click(await screen.findByRole("menuitem", { name: "Undo this step" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not complete: conflict");
  });

  it("copies the label of the step", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    setup();
    await user.click(screen.getByRole("button", { name: "Actions for step Move Title" }));
    await user.click(await screen.findByRole("menuitem", { name: "Copy label" }));
    expect(writeText).toHaveBeenCalledWith("Move Title");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  });

  it("confirms the copy with a status message", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(() => Promise.resolve()) } });
    setup();
    await user.click(screen.getByRole("button", { name: "Actions for step Move Title" }));
    await user.click(await screen.findByRole("menuitem", { name: "Copy label" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Label copied");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  });

  it("says when the label could not be copied", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(() => Promise.reject(new Error("denied"))) } });
    Object.defineProperty(document, "execCommand", { configurable: true, value: () => false });
    setup();
    await user.click(screen.getByRole("button", { name: "Actions for step Move Title" }));
    await user.click(await screen.findByRole("menuitem", { name: "Copy label" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Could not copy the label");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    Reflect.deleteProperty(document, "execCommand");
  });

  it("marks the step as busy while its own action runs and clears it when it settles", async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    const running = new Promise<void>((resolve) => {
      finish = resolve;
    });
    setup({ onUndoStep: vi.fn(() => running) });
    await user.click(screen.getByRole("button", { name: "Actions for step Move Title" }));
    await user.click(await screen.findByRole("menuitem", { name: "Undo this step" }));
    expect(screen.getByRole("button", { name: /^Move Title/ })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: /^Rename layers/ })).not.toHaveAttribute("aria-busy");
    await act(async () => {
      finish();
      await running;
    });
    expect(screen.getByRole("button", { name: /^Move Title/ })).not.toHaveAttribute("aria-busy");
  });

  it("closes with Escape when the focus is inside and with the close button", async () => {
    const user = userEvent.setup();
    const { onClose } = setup();
    expect(screen.getByTestId("history-panel")).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Close history" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("does not close when Escape is pressed outside the panel", async () => {
    const user = userEvent.setup();
    const { onClose } = setup();
    screen.getByTestId("history-panel").blur();
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("only renders the visible window of a long history", () => {
    const many = Array.from({ length: 2000 }, (_, i) => step(String(i), i % 2 ? you : claude, `Step ${i}`, i * 1000));
    setup({ steps: many });
    expect(document.querySelectorAll("[data-step-id]").length).toBeLessThan(80);
    expect(document.querySelectorAll("[data-step-id]").length).toBeGreaterThan(0);
  });

  it("uses the injected clock for the relative times", () => {
    setup({ now: undefined, clock: () => NOW + 3_600_000 });
    expect(within(rowOf(/^Align buttons/)).getByText("1 h")).toBeInTheDocument();
  });

  it("renders in pt-BR with plurals", async () => {
    await i18n.changeLanguage("pt-BR");
    try {
      setup();
      expect(screen.getByRole("region", { name: "Histórico" })).toBeInTheDocument();
      expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["claude3 passos · agora", "codex1 passo · 2 min", "você2 passos · 3 min"]);
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("renders on the server", () => {
    const html = renderToString(<HistoryPanel steps={steps} now={NOW} onUndoStep={vi.fn()} onRedoStep={vi.fn()} onSelectNodes={vi.fn()} onClose={vi.fn()} />);
    expect(html).toContain("History");
  });
});
