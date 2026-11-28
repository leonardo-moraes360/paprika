import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { applyOps, createDocument, type Document, type LintIssue, type Node, type Op } from "@paprika/core";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import type { SetProps } from "./types";
import { PropertiesPanel, useCreatePropertiesPanelStore, PropertiesPanelProvider, type ActivityEntry, type PropertiesPanelProps } from "./index";

function buildDocument(): Document {
  const base = createDocument("Studio", "doc1");
  const ops: Op[] = [
    { op: "set_tokens", tokens: { brand: "rgb(232, 85, 61)" }, type: "color" },
    { op: "set_tokens", tokens: { gap: 8 } },
    { op: "set_tokens", mode: "dark", tokens: { brand: "rgb(255, 122, 92)" } },
    { op: "create", node: { type: "page", id: "p1", name: "Cover" } },
    {
      op: "create",
      parentId: "p1",
      node: { type: "frame", id: "f1", name: "Home", x: 120, y: 140, width: 520, height: 340, fill: "rgb(26, 31, 49)", radius: 4, layout: { mode: "column", gap: 24, padding: 48 } },
    },
    { op: "create", parentId: "f1", node: { type: "text", id: "t1", name: "Title", text: "Hello", fontFamily: "Inter, sans-serif", fontSize: 30, fontWeight: 700, color: "$brand" } },
    { op: "create", parentId: "f1", node: { type: "rect", id: "r1", name: "Button", x: 10, y: 10, width: 100, height: 50, fill: "rgb(200, 64, 31)", radius: 6 } },
    { op: "create", parentId: "f1", node: { type: "ellipse", id: "e1", name: "Dot", x: 200, y: 10, width: 40, height: 40, fill: "rgb(255, 192, 42)" } },
    { op: "create", parentId: "p1", node: { type: "frame", id: "f2", name: "Free", x: 700, y: 140, width: 200, height: 120 } },
    { op: "create", parentId: "f2", node: { type: "rect", id: "r2", name: "Absolute", x: 10, y: 10, width: 40, height: 40 } },
    { op: "create", parentId: "f2", node: { type: "rect", id: "r3", name: "Second", x: 60, y: 10, width: 40, height: 40 } },
    { op: "create", parentId: "p1", node: { type: "frame", id: "c1", name: "Card", x: 0, y: 600, width: 200, height: 100, component: true, componentProps: [{ name: "label", type: "text", default: "Hi" }] } },
    { op: "create", parentId: "p1", node: { type: "frame", id: "i1", name: "Card copy", instanceOf: "c1", x: 240, y: 600 } },
    { op: "create", parentId: "p1", node: { type: "connector", id: "k1", name: "Link", from: { nodeId: "r1" }, to: { nodeId: "e1" } } },
  ];
  return applyOps(base, ops).doc;
}


function withGroup(doc: Document): Document {
  const next = applyOps(doc, [{ op: "group", ids: ["r2", "r3"], id: "g1" }]).doc;
  return next;
}

type Setup = Partial<PropertiesPanelProps> & { id?: string | string[] | null; open?: string[] };

function setup({ id = null, doc: docProp, open, ...rest }: Setup = {}) {
  if (open) {
    window.localStorage.setItem("paprika.test.open", JSON.stringify(Object.fromEntries(open.map((section) => [section, true]))));
    rest.storageKey = "test.open";
  }
  const doc = docProp === undefined ? buildDocument() : docProp;
  const ids = id === null ? [] : Array.isArray(id) ? id : [id];
  const handlers = { onApply: vi.fn(), onSelect: vi.fn(), onError: vi.fn() };
  const node = doc && ids.length === 1 ? (doc.nodes[ids[0] as string] ?? null) : null;
  const view = render(<PropertiesPanel doc={doc} node={node} selected={ids} {...handlers} {...rest} />);
  return { doc, ...handlers, ...view };
}

const box = (name: string) => screen.getByRole("textbox", { name });
const choose = async (user: ReturnType<typeof userEvent.setup>, field: string, option: string) => {
  await user.click(screen.getByRole("combobox", { name: field }));
  await user.click(await screen.findByRole("option", { name: option }));
};

const emptyFailures: [string, () => unknown][] = [["an empty message", () => new Error("")], ["no error value", () => undefined]];

describe("PropertiesPanel states", () => {
  it("says nothing is selected when there is no document", () => {
    setup({ doc: null });
    expect(screen.getByText("Nothing selected.")).toBeInTheDocument();
  });

  it("shows the document panel when nothing is selected", () => {
    setup();
    expect(screen.getByRole("heading", { level: 2, name: "Workspace" })).toBeInTheDocument();
    expect(box("Name")).toHaveValue("Studio");
    expect(screen.getByRole("heading", { level: 3, name: /Tokens/ })).toBeInTheDocument();
  });

  it("shows a node panel with kind and id", () => {
    setup({ id: "f1" });
    expect(screen.getByRole("heading", { level: 2, name: /frame #f1/ })).toBeInTheDocument();
    expect(box("Name")).toHaveValue("Home");
  });

  it("shows the page panel", () => {
    setup({ id: "p1" });
    expect(screen.getByTestId("page-panel")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Background and theme" })).toBeInTheDocument();
  });

  it("shows the multi-selection panel with a count", () => {
    setup({ id: ["r1", "e1"] });
    expect(screen.getByRole("heading", { level: 2, name: "2 elements selected" })).toBeInTheDocument();
  });

  it("renders the header slot above the scrolling body", () => {
    setup({ header: <div>tabs here</div> });
    expect(screen.getByText("tabs here")).toBeInTheDocument();
  });

  it("renders every state in Portuguese without leaking translation keys", async () => {
    await i18n.changeLanguage("pt-BR");
    try {
      const doc = withGroup(buildDocument());
      const lint: LintIssue[] = [{ rule: "contrast", severity: "error", nodeId: "t1", message: "baixo" }];
      for (const id of [null, "p1", "f1", "t1", "r1", "g1", "i1", "c1", "k1", ["r1", "e1"]] as const) {
        const view = setup({ doc, id: id as never, lint, activity: [{ id: "a", author: "claude", label: "mover", time: "agora" }] });
        expect(view.container.textContent).not.toMatch(/frontends\.propertiesPanel/);
        view.unmount();
      }
      setup({ id: "f1" });
      expect(screen.getByRole("heading", { level: 3, name: "Posição e tamanho" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { level: 3, name: "Preenchimento e traço" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { level: 3, name: "Layout auto" })).toBeInTheDocument();
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("renders every state in English without leaking translation keys", () => {
    const doc = withGroup(buildDocument());
    for (const id of [null, "p1", "f1", "t1", "r1", "g1", "i1", "c1", "k1", ["r1", "e1"]] as const) {
      const view = setup({ doc, id: id as never, lint: [], activity: [] });
      expect(view.container.textContent).not.toMatch(/frontends\.propertiesPanel/);
      view.unmount();
    }
  });

  it("renders on the server", () => {
    const doc = buildDocument();
    const html = renderToString(<PropertiesPanel doc={doc} node={doc.nodes.f1 ?? null} selected={["f1"]} onApply={() => {}} onSelect={() => {}} />);
    expect(html).toContain("Position and size");
  });

  it("keeps the layout logical under dir=rtl: the corner grid stays physical", () => {
    const doc = buildDocument();
    const corners: Document = { ...doc, nodes: { ...doc.nodes, f1: { ...(doc.nodes.f1 as object), radius: [1, 2, 3, 4] } as never } };
    render(
      <div dir="rtl">
        <PropertiesPanel doc={corners} node={corners.nodes.f1 ?? null} selected={["f1"]} onApply={() => {}} onSelect={() => {}} />
      </div>,
    );
    expect(box("Top left radius").closest("[dir=ltr]")).not.toBeNull();
  });
});

describe("Switching the selection", () => {
  const twins = () => applyOps(buildDocument(), [{ op: "update", id: "r1", props: { x: 120 } }]).doc;

  it("drops an unfinished number when another node with the same value is selected", async () => {
    const user = userEvent.setup();
    const doc = twins();
    const handlers = { onApply: vi.fn(), onSelect: vi.fn(), onError: vi.fn() };
    const view = render(<PropertiesPanel doc={doc} node={doc.nodes.f1 ?? null} selected={["f1"]} {...handlers} />);
    await user.clear(box("X"));
    await user.type(box("X"), "55");
    view.rerender(<PropertiesPanel doc={doc} node={doc.nodes.r1 ?? null} selected={["r1"]} {...handlers} />);
    expect(box("X")).toHaveValue("120");
    expect(handlers.onApply).not.toHaveBeenCalled();
  });

  it("unlocks the proportion when another node is selected", async () => {
    const user = userEvent.setup();
    const doc = buildDocument();
    const handlers = { onApply: vi.fn(), onSelect: vi.fn(), onError: vi.fn() };
    const view = render(<PropertiesPanel doc={doc} node={doc.nodes.f1 ?? null} selected={["f1"]} {...handlers} />);
    await user.click(screen.getByRole("button", { name: "Lock proportion" }));
    view.rerender(<PropertiesPanel doc={doc} node={doc.nodes.r1 ?? null} selected={["r1"]} {...handlers} />);
    expect(screen.getByRole("button", { name: "Lock proportion" })).toHaveAttribute("aria-pressed", "false");
  });

  it("uses the panel surface token", () => {
    setup({ id: "f1" });
    expect(screen.getByRole("complementary").className).toContain("bg-panel");
    expect(screen.getByRole("complementary").className).not.toContain("bg-tile");
  });
});

describe("Position and size", () => {
  it("commits X with Enter and labels the operation", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ id: "f1" });
    await user.clear(box("X"));
    await user.type(box("X"), "200{Enter}");
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith([{ op: "update", id: "f1", props: { x: 200 } }], "move");
    expect(box("X")).toHaveFocus();
  });

  it("shows the owner's value again and lets the same number be sent twice when the owner did not apply it", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ id: "f1" });
    await user.clear(box("X"));
    await user.type(box("X"), "200{Enter}");
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(box("X")).toHaveValue("120");
    await user.clear(box("X"));
    await user.type(box("X"), "200{Enter}");
    expect(onApply).toHaveBeenCalledTimes(2);
    expect(box("X")).toHaveValue("120");
  });

  it("does not send the same number twice for Enter followed by blur", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ id: "f1" });
    await user.clear(box("X"));
    await user.type(box("X"), "200{Enter}");
    await user.tab();
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("follows the owner when it applies the value", async () => {
    const user = userEvent.setup();
    const doc = buildDocument();
    const handlers = { onApply: vi.fn(), onSelect: vi.fn(), onError: vi.fn() };
    const view = render(<PropertiesPanel doc={doc} node={doc.nodes.f1 ?? null} selected={["f1"]} {...handlers} />);
    await user.clear(box("X"));
    await user.type(box("X"), "200{Enter}");
    const next = applyOps(doc, [{ op: "update", id: "f1", props: { x: 200 } }]).doc;
    view.rerender(<PropertiesPanel doc={next} node={next.nodes.f1 ?? null} selected={["f1"]} {...handlers} />);
    expect(box("X")).toHaveValue("200");
  });

  it("steps with the arrow keys and ten times as much with Shift", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ id: "f1" });
    await user.click(box("X"));
    await user.keyboard("{ArrowUp}");
    expect(onApply).toHaveBeenLastCalledWith([{ op: "update", id: "f1", props: { x: 121 } }], "move");
    // the owner did not echo the first step yet, so the next one starts from the value the field emitted (121)
    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
    expect(onApply).toHaveBeenLastCalledWith([{ op: "update", id: "f1", props: { x: 111 } }], "move");
  });

  it("steps with the stepper buttons", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ id: "f1" });
    await user.click(screen.getByRole("button", { name: "Increase Y" }));
    expect(onApply).toHaveBeenCalledWith([{ op: "update", id: "f1", props: { y: 141 } }], "move");
  });

  it("restores the value on Escape without emitting", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ id: "f1" });
    await user.click(box("X"));
    await user.keyboard("{Control>}a{/Control}999{Escape}");
    expect(box("X")).toHaveValue("120");
    await user.tab();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("explains an empty value and does not emit", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ id: "f1" });
    await user.clear(box("X"));
    await user.keyboard("{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent("Use a number.");
    expect(box("X")).toHaveValue("120");
    expect(box("X")).toHaveAttribute("aria-invalid", "true");
    expect(onApply).not.toHaveBeenCalled();
  });

  it("refuses letters while typing", async () => {
    const user = userEvent.setup();
    setup({ id: "f1" });
    await user.clear(box("X"));
    await user.type(box("X"), "1a2");
    expect(box("X")).toHaveValue("12");
  });

  it("shows opacity as a percentage", () => {
    setup({ id: "f1" });
    expect(box("Opacity")).toHaveValue("100");
    expect(screen.getByText("%")).toBeInTheDocument();
  });

  it("accepts a comma as the decimal separator for opacity and sends a number from 0 to 1", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ id: "f1" });
    await user.clear(box("Opacity"));
    await user.type(box("Opacity"), "33,5{Enter}");
    expect(onApply).toHaveBeenCalledWith([{ op: "update", id: "f1", props: { opacity: 0.335 } }], "change opacity");
  });

  it("shows a stored opacity of 0.4 as 40 and steps it by one percent", async () => {
    const user = userEvent.setup();
    const doc = applyOps(buildDocument(), [{ op: "update", id: "f1", props: { opacity: 0.4 } }]).doc;
    const { onApply } = setup({ id: "f1", doc });
    expect(box("Opacity")).toHaveValue("40");
    await user.click(screen.getByRole("button", { name: "Increase Opacity" }));
    expect(onApply).toHaveBeenCalledWith([{ op: "update", id: "f1", props: { opacity: 0.41 } }], "change opacity");
  });

  it("clamps opacity into 0..100 and explains it", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ id: "f1" });
    await user.clear(box("Opacity"));
    await user.type(box("Opacity"), "140{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent("Use a number between 0 and 100.");
    expect(box("Opacity")).toHaveValue("100");
    expect(onApply).not.toHaveBeenCalled();
  });

  it("explains the range when opacity is out of it on a node already at the limit", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ id: "f1" });
    await user.clear(box("Opacity"));
    await user.type(box("Opacity"), "700{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent("Use a number between 0 and 100.");
    expect(onApply).not.toHaveBeenCalled();
  });

  it("keeps the steppers on width and height, which also take hug and fill", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ id: "f1" });
    await user.click(screen.getByRole("button", { name: "Increase Width" }));
    expect(onApply).toHaveBeenCalledWith([{ op: "update", id: "f1", props: { width: 521 } }], "resize");
    expect(screen.getByRole("button", { name: "Decrease Height" })).toBeInTheDocument();
    await user.click(box("Height"));
    await user.keyboard("{ArrowDown}");
    expect(onApply).toHaveBeenLastCalledWith([{ op: "update", id: "f1", props: { height: 339 } }], "resize");
  });

  it("accepts the hug and fill keywords for the size", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ id: "f1" });
    await user.clear(box("Width"));
    await user.type(box("Width"), "fill{Enter}");
    expect(onApply).toHaveBeenCalledWith([{ op: "update", id: "f1", props: { width: "fill" } }], "resize");
  });

  it("lets the side that was edited command the other one when the proportion is locked", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ id: "f1" });
    await user.click(screen.getByRole("button", { name: "Lock proportion" }));
    expect(screen.getByRole("button", { name: "Unlock proportion" })).toHaveAttribute("aria-pressed", "true");
    await user.clear(box("Width"));
    await user.type(box("Width"), "1040{Enter}");
    expect(onApply).toHaveBeenCalledWith([{ op: "update", id: "f1", props: { width: 1040, height: 680 } }], "resize");
    await user.clear(box("Height"));
    await user.type(box("Height"), "170{Enter}");
    expect(onApply).toHaveBeenLastCalledWith([{ op: "update", id: "f1", props: { width: 260, height: 170 } }], "resize");
  });

  it("changes only one side when the proportion is not locked", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ id: "f1" });
    await user.clear(box("Height"));
    await user.type(box("Height"), "100{Enter}");
    expect(onApply).toHaveBeenCalledWith([{ op: "update", id: "f1", props: { height: 100 } }], "resize");
  });

  it("toggles ignore-layout only for children of an auto layout", async () => {
    const user = userEvent.setup();
    const { onApply, unmount } = setup({ id: "r1", open: ["effects"] });
    await user.click(screen.getByRole("switch", { name: /Ignore layout/ }));
    expect(onApply).toHaveBeenCalledWith([{ op: "update", id: "r1", props: { layoutPositioning: "absolute" } }], "ignore layout");
    unmount();
    setup({ id: "r2" });
    expect(screen.queryByRole("switch", { name: /Ignore layout/ })).not.toBeInTheDocument();
  });

  it("edits the constraints of a child of a free frame", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ id: "r2", open: ["constraints"] });
    await user.click(within(screen.getByRole("radiogroup", { name: "Horizontal constraint" })).getByRole("radio", { name: "Right" }));
    expect(onApply).toHaveBeenCalledWith([{ op: "update", id: "r2", props: { constraints: { horizontal: "right", vertical: "top" } } }], "constraints");
  });
});

describe("Section state", () => {
  it("collapses a section and remembers it under the storage key", async () => {
    const user = userEvent.setup();
    const first = setup({ id: "f1", storageKey: "test.properties" });
    await user.click(screen.getByRole("button", { name: "Position and size" }));
    expect(screen.queryByRole("textbox", { name: "X" })).not.toBeInTheDocument();
    expect(window.localStorage.getItem("paprika.test.properties")).toBe(JSON.stringify({ position: false }));
    first.unmount();
    setup({ id: "f1", storageKey: "test.properties" });
    expect(screen.queryByRole("textbox", { name: "X" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Position and size" }));
    expect(box("X")).toBeInTheDocument();
  });

  it("slides a section's body over its height, and not under reduced motion", () => {
    setup({ id: "f1" });
    const body = document.getElementById(screen.getByRole("button", { name: "Position and size" }).getAttribute("aria-controls") as string);
    expect(body).toHaveClass("transition-[height]", "motion-reduce:transition-none", "data-ending-style:h-0", "data-starting-style:h-0");
  });

  it("renders the same first markup whatever is stored, and applies the stored state after mounting", async () => {
    const doc = buildDocument();
    const node = doc.nodes.f1 ?? null;
    const tree = <PropertiesPanel doc={doc} node={node} selected={["f1"]} onApply={vi.fn()} onSelect={vi.fn()} storageKey="test.hydrate" />;
    const clean = renderToString(tree);
    window.localStorage.setItem("paprika.test.hydrate", JSON.stringify({ position: false }));
    expect(renderToString(tree)).toBe(clean);
    render(tree);
    await screen.findByRole("button", { name: "Position and size" });
    expect(screen.getByRole("button", { name: "Position and size" })).toHaveAttribute("aria-expanded", "false");
  });

  it("does not write anything without a storage key", async () => {
    const user = userEvent.setup();
    setup({ id: "f1" });
    await user.click(screen.getByRole("button", { name: "Position and size" }));
    expect(window.localStorage.length).toBe(0);
  });

  it("ignores a corrupted stored value", () => {
    window.localStorage.setItem("paprika.test.bad", "not json");
    setup({ id: "f1", storageKey: "test.bad" });
    expect(box("X")).toBeInTheDocument();
  });

  it("shares the open state through a store made by the owner", async () => {
    const user = userEvent.setup();
    const doc = buildDocument();
    let observed: Record<string, boolean> = {};
    function Owner() {
      const store = useCreatePropertiesPanelStore({ open: { position: false } });
      observed = store.get().open;
      return (
        <PropertiesPanelProvider store={store}>
          <PropertiesPanel store={store} doc={doc} node={doc.nodes.f1 ?? null} selected={["f1"]} onApply={() => {}} onSelect={() => {}} />
        </PropertiesPanelProvider>
      );
    }
    render(<Owner />);
    expect(screen.queryByRole("textbox", { name: "X" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Position and size" }));
    expect(box("X")).toBeInTheDocument();
    expect(observed).toEqual({ position: false });
  });
});

describe("Auto layout", () => {
  it("changes the mode and can turn the layout off", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ id: "f1" });
    await choose(user, "Mode", "row");
    expect(onApply).toHaveBeenCalledWith([{ op: "update", id: "f1", props: { layout: { mode: "row", gap: 24, padding: 48, align: "start", justify: "start", wrap: false } } }], "layout");
    await choose(user, "Mode", "free");
    expect(onApply).toHaveBeenLastCalledWith([{ op: "update", id: "f1", props: { layout: null } }], "layout");
  });

  it("commits the gap and merges it into the layout", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ id: "f1" });
    await user.clear(box("Gap"));
    await user.type(box("Gap"), "12{Enter}");
    const call = onApply.mock.calls[0] as [{ props: { layout: Record<string, unknown> } }[], string];
    expect(call[0][0]?.props.layout).toMatchObject({ mode: "column", gap: 12, padding: 48 });
    expect(call[1]).toBe("layout");
  });

  it("edits a uniform padding as a number with steppers", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ id: "f1" });
    expect(box("Padding")).toHaveValue("48");
    await user.click(screen.getByRole("button", { name: "Increase Padding" }));
    const call = onApply.mock.calls[0] as [{ props: { layout: Record<string, unknown> } }[], string];
    expect(call[0][0]?.props.layout).toMatchObject({ padding: 49, gap: 24 });
  });

  it("switches to four sides and back to one", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ id: "f1" });
    await user.click(screen.getByRole("button", { name: "Padding per side" }));
    const first = onApply.mock.calls[0] as [{ props: { layout: { padding: unknown } } }[], string];
    expect(first[0][0]?.props.layout.padding).toEqual([48, 48, 48, 48]);
  });

  it("offers one value for a four-sided padding", async () => {
    const user = userEvent.setup();
    const doc = applyOps(buildDocument(), [{ op: "update", id: "f1", props: { layout: { mode: "column", gap: 24, padding: [1, 2, 3, 4] } } }]).doc;
    const { onApply } = setup({ id: "f1", doc });
    expect(box("Padding")).toHaveValue("1 2 3 4");
    await user.click(screen.getByRole("button", { name: "Same padding on all sides" }));
    const call = onApply.mock.calls[0] as [{ props: { layout: { padding: unknown } } }[], string];
    expect(call[0][0]?.props.layout.padding).toBe(1);
  });

  it("accepts one or four padding values and rejects the rest", async () => {
    const user = userEvent.setup();
    const doc = applyOps(buildDocument(), [{ op: "update", id: "f1", props: { layout: { mode: "column", gap: 24, padding: [48, 48, 48, 48] } } }]).doc;
    const { onApply } = setup({ id: "f1", doc });
    await user.clear(box("Padding"));
    await user.type(box("Padding"), "1 2{Enter}");
    expect(screen.getByText("Use 1 value or 4 values, not negative.")).toBeInTheDocument();
    expect(box("Padding")).toHaveValue("48 48 48 48");
    expect(onApply).not.toHaveBeenCalled();
    await user.clear(box("Padding"));
    await user.type(box("Padding"), "1 2 3 4{Enter}");
    const call = onApply.mock.calls[0] as [{ props: { layout: { padding: unknown } } }[], string];
    expect(call[0][0]?.props.layout.padding).toEqual([1, 2, 3, 4]);
  });

  it("toggles clip", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ id: "f1" });
    await choose(user, "Clip", "no");
    expect(onApply).toHaveBeenCalledWith([{ op: "update", id: "f1", props: { clip: false } }], "clip");
  });

  it("hides spacing and distribution while the layout is free", () => {
    setup({ id: "f2" });
    expect(screen.queryByRole("textbox", { name: "Gap" })).not.toBeInTheDocument();
  });
});

describe("Fill, radius and border", () => {
  it("switches to a gradient keeping the current color as the first stop", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ id: "f1" });
    await user.click(screen.getByRole("radio", { name: "Linear" }));
    const call = onApply.mock.calls[0] as [{ props: { gradient: { type: string; angle: number; stops: { color: string }[] } } }[], string];
    expect(call[1]).toBe("fill");
    expect(call[0][0]?.props.gradient).toMatchObject({ type: "linear", angle: 90 });
    expect(call[0][0]?.props.gradient.stops[0]?.color).toBe("rgb(26, 31, 49)");
  });

  it("goes back to a solid fill", async () => {
    const user = userEvent.setup();
    const doc = buildDocument();
    const { onApply } = setup({ id: "f1", doc });
    await user.click(screen.getByRole("radio", { name: "Radial" }));
    const gradient = (onApply.mock.calls[0] as [{ props: { gradient: unknown } }[]])[0][0]?.props.gradient;
    const next: Document = { ...doc, nodes: { ...doc.nodes, f1: { ...(doc.nodes.f1 as object), gradient } as never } };
    const second = setup({ id: "f1", doc: next });
    await user.click(within(second.container).getByRole("radio", { name: "Solid" }));
    expect(second.onApply).toHaveBeenCalledWith([{ op: "update", id: "f1", props: { gradient: null } }], "fill");
  });

  it("edits and removes gradient stops and moves focus to the add button", async () => {
    const user = userEvent.setup();
    const doc = buildDocument();
    const gradient = { type: "linear", angle: 90, cx: 0.5, cy: 0.5, radius: 0.5, stops: [{ color: "#111111", offset: 0 }, { color: "#222222", offset: 0.5 }, { color: "#333333", offset: 1 }] };
    const withGradient: Document = { ...doc, nodes: { ...doc.nodes, f1: { ...(doc.nodes.f1 as object), gradient } as never } };
    const { onApply } = setup({ id: "f1", doc: withGradient });
    await user.clear(box("Position of color stop 2"));
    await user.type(box("Position of color stop 2"), "60{Enter}");
    expect((onApply.mock.calls[0] as [{ props: { gradient: { stops: { offset: number }[] } } }[]])[0][0]?.props.gradient.stops[1]?.offset).toBe(0.6);
    await user.click(screen.getByRole("button", { name: "Remove color stop 3" }));
    expect((onApply.mock.calls[1] as [{ props: { gradient: { stops: unknown[] } } }[]])[0][0]?.props.gradient.stops).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Add color stop" })).toHaveFocus();
    await user.clear(box("Angle"));
    await user.type(box("Angle"), "45{Enter}");
    expect((onApply.mock.calls[2] as [{ props: { gradient: { angle: number } } }[]])[0][0]?.props.gradient.angle).toBe(45);
  });

  it("sets a typed color or token through the color popover", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ id: "f1" });
    await user.click(screen.getByRole("button", { name: /^Fill ?(rgb|none|#|\$)/ }));
    await user.clear(await screen.findByRole("textbox", { name: "Value" }));
    await user.type(screen.getByRole("textbox", { name: "Value" }), "$brand{Enter}");
    expect(onApply).toHaveBeenCalledWith([{ op: "update", id: "f1", props: { fill: "$brand" } }], "fill");
  });

  it("opens the color picker on the current color, whatever its format", async () => {
    const user = userEvent.setup();
    setup({ id: "f1" });
    await user.click(screen.getByRole("button", { name: /^Fill ?rgb/ }));
    expect(await screen.findByRole("textbox", { name: "Hex value" })).toHaveValue("rgb(26, 31, 49)");
  });

  it("opens the color picker on the resolved color of a token", async () => {
    const user = userEvent.setup();
    setup({ id: "t1" });
    await user.click(screen.getByRole("button", { name: /^Text color ?rgb/ }));
    expect(await screen.findByRole("textbox", { name: "Hex value" })).toHaveValue("rgb(232, 85, 61)");
  });

  it("shows a token chip for a color bound to a token", () => {
    setup({ id: "t1" });
    expect(screen.getAllByText("$brand").length).toBeGreaterThan(0);
  });

  it("removes the fill with the remove button", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ id: "f1" });
    await user.click(screen.getByRole("button", { name: /^Fill ?(rgb|none|#|\$)/ }));
    await user.click(await screen.findByRole("button", { name: "Remove color" }));
    expect(onApply).toHaveBeenCalledWith([{ op: "update", id: "f1", props: { fill: null } }], "fill");
  });

  it("starts a border with sensible defaults, then edits its width, style and position", async () => {
    const user = userEvent.setup();
    const doc = buildDocument();
    const first = setup({ id: "f1", doc });
    await user.click(screen.getByRole("button", { name: /^Border ?none/ }));
    await user.type(await screen.findByRole("textbox", { name: "Value" }), "#ff0000{Enter}");
    expect(first.onApply).toHaveBeenCalledWith([{ op: "update", id: "f1", props: { stroke: { color: "#ff0000", width: 1, style: "solid", position: "inside" } } }], "border");
    first.unmount();
    const bordered: Document = { ...doc, nodes: { ...doc.nodes, f1: { ...(doc.nodes.f1 as object), stroke: { color: "#ff0000", width: 1, style: "solid", position: "inside" } } as never } };
    const second = setup({ id: "f1", doc: bordered });
    await user.clear(box("Border width"));
    await user.type(box("Border width"), "3{Enter}");
    expect(second.onApply).toHaveBeenLastCalledWith([{ op: "update", id: "f1", props: { stroke: { color: "#ff0000", width: 3, style: "solid", position: "inside" } } }], "border");
    await choose(user, "Border style", "dashed");
    expect(second.onApply).toHaveBeenLastCalledWith([{ op: "update", id: "f1", props: { stroke: { color: "#ff0000", width: 1, style: "dashed", position: "inside" } } }], "border");
    await choose(user, "Border position", "outside");
    expect(second.onApply).toHaveBeenLastCalledWith([{ op: "update", id: "f1", props: { stroke: { color: "#ff0000", width: 1, style: "solid", position: "outside" } } }], "border");
  });

  it("has no per-side border controls", () => {
    setup({ id: "f1" });
    expect(screen.queryByText(/top border|border per side/i)).not.toBeInTheDocument();
  });

  it("edits a single radius and unlinks into four corners", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ id: "f1" });
    await user.clear(box("Radius"));
    await user.type(box("Radius"), "10{Enter}");
    expect(onApply).toHaveBeenLastCalledWith([{ op: "update", id: "f1", props: { radius: 10 } }], "corner radius");
    await user.click(screen.getByRole("button", { name: "Unlink corners" }));
    expect(onApply).toHaveBeenLastCalledWith([{ op: "update", id: "f1", props: { radius: [4, 4, 4, 4] } }], "corner radius");
  });

  it("edits each corner of an unlinked radius and links them back", async () => {
    const user = userEvent.setup();
    const doc = buildDocument();
    const corners: Document = { ...doc, nodes: { ...doc.nodes, f1: { ...(doc.nodes.f1 as object), radius: [1, 2, 3, 4] } as never } };
    const { onApply } = setup({ id: "f1", doc: corners });
    expect(box("Top left radius")).toHaveValue("1");
    expect(box("Top right radius")).toHaveValue("2");
    expect(box("Bottom right radius")).toHaveValue("3");
    expect(box("Bottom left radius")).toHaveValue("4");
    await user.clear(box("Bottom left radius"));
    await user.type(box("Bottom left radius"), "9{Enter}");
    expect(onApply).toHaveBeenLastCalledWith([{ op: "update", id: "f1", props: { radius: [1, 2, 3, 9] } }], "corner radius");
    await user.click(screen.getByRole("button", { name: "Link corners" }));
    expect(onApply).toHaveBeenLastCalledWith([{ op: "update", id: "f1", props: { radius: 1 } }], "corner radius");
  });
});

describe("Typography", () => {
  it("edits the content and drops stale runs", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ id: "t1" });
    await user.clear(box("Content"));
    await user.type(box("Content"), "Bye{Enter}");
    expect(onApply).toHaveBeenCalledWith([{ op: "update", id: "t1", props: { text: "Bye" } }], "edit text");
  });

  it("uses the font picker slot with the current family and applies its choice", async () => {
    const user = userEvent.setup();
    const slot = vi.fn(({ value, onValueChange }: { value: string; onValueChange: (family: string) => void }) => <button onClick={() => onValueChange("Georgia, serif")}>{`font:${value}`}</button>);
    const { onApply } = setup({ id: "t1", renderFontPicker: slot });
    await user.click(screen.getByRole("button", { name: "font:Inter, sans-serif" }));
    expect(onApply).toHaveBeenCalledWith([{ op: "update", id: "t1", props: { fontFamily: "Georgia, serif" } }], "typography");
  });

  it("falls back to a plain family field without the slot", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ id: "t1" });
    await user.clear(box("Font family"));
    await user.type(box("Font family"), "Fira Sans{Enter}");
    expect(onApply).toHaveBeenCalledWith([{ op: "update", id: "t1", props: { fontFamily: "Fira Sans" } }], "typography");
  });

  it("accepts numbers and $tokens for the metrics and rejects other text", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ id: "t1" });
    await user.clear(box("Size"));
    await user.type(box("Size"), "$gap{Enter}");
    expect(onApply).toHaveBeenLastCalledWith([{ op: "update", id: "t1", props: { fontSize: "$gap" } }], "typography");
    await user.clear(box("Weight"));
    await user.type(box("Weight"), "500{Enter}");
    expect(onApply).toHaveBeenLastCalledWith([{ op: "update", id: "t1", props: { fontWeight: 500 } }], "typography");
    await user.clear(box("Line height"));
    await user.type(box("Line height"), "tall{Enter}");
    expect(screen.getByText("Use a number or a $token.")).toBeInTheDocument();
    expect(onApply).toHaveBeenCalledTimes(2);
  });

  it("changes the alignment", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ id: "t1" });
    await user.click(screen.getByRole("radio", { name: "center" }));
    expect(onApply).toHaveBeenCalledWith([{ op: "update", id: "t1", props: { textAlign: "center" } }], "typography");
  });

  it("sets and clears the link", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ id: "t1" });
    await user.type(box("Link"), "/home{Enter}");
    expect(onApply).toHaveBeenCalledWith([{ op: "update", id: "t1", props: { href: "/home" } }], "link");
  });
});

describe("Effects", () => {
  it("adds a shadow, then a second one becomes a list", async () => {
    const user = userEvent.setup();
    const doc = buildDocument();
    const first = setup({ id: "r1", doc , open: ["effects"] });
    await user.click(screen.getByRole("button", { name: "Add shadow" }));
    expect(first.onApply).toHaveBeenCalledWith([{ op: "update", id: "r1", props: { shadow: { x: 0, y: 4, blur: 12, spread: 0, color: "rgba(0, 0, 0, 0.25)" } } }], "effects");
    first.unmount();
    const shadow = { x: 0, y: 2, blur: 4, spread: 0, color: "rgb(0, 0, 0)" };
    const shadowed: Document = { ...doc, nodes: { ...doc.nodes, r1: { ...(doc.nodes.r1 as object), shadow } as never } };
    const second = setup({ id: "r1", doc: shadowed , open: ["effects"] });
    await user.click(screen.getByRole("button", { name: "Add shadow" }));
    expect((second.onApply.mock.calls[0] as [{ props: { shadow: unknown[] } }[]])[0][0]?.props.shadow).toHaveLength(2);
  });

  it("edits, flips to inner and removes a shadow, focusing the add button", async () => {
    const user = userEvent.setup();
    const doc = buildDocument();
    const shadow = { x: 0, y: 2, blur: 4, spread: 0, color: "rgb(0, 0, 0)" };
    const shadowed: Document = { ...doc, nodes: { ...doc.nodes, r1: { ...(doc.nodes.r1 as object), shadow } as never } };
    const { onApply } = setup({ id: "r1", doc: shadowed , open: ["effects"] });
    await user.clear(box("Shadow blur"));
    await user.type(box("Shadow blur"), "20{Enter}");
    expect(onApply).toHaveBeenLastCalledWith([{ op: "update", id: "r1", props: { shadow: { ...shadow, blur: 20 } } }], "effects");
    await user.click(screen.getByRole("button", { name: "Inner" }));
    expect(onApply).toHaveBeenLastCalledWith([{ op: "update", id: "r1", props: { shadow: { ...shadow, inner: true } } }], "effects");
    await user.click(screen.getByRole("button", { name: "Remove shadow 1" }));
    expect(onApply).toHaveBeenLastCalledWith([{ op: "update", id: "r1", props: { shadow: null } }], "effects");
    expect(screen.getByRole("button", { name: "Add shadow" })).toHaveFocus();
  });

  it("sets a filter and clears it when the field is emptied", async () => {
    const user = userEvent.setup();
    const doc = buildDocument();
    const first = setup({ id: "r1", doc , open: ["effects"] });
    await user.type(box("Filter: Blur"), "4{Enter}");
    expect(first.onApply).toHaveBeenCalledWith([{ op: "update", id: "r1", props: { filter: { blur: 4 } } }], "effects");
    first.unmount();
    const filtered: Document = { ...doc, nodes: { ...doc.nodes, r1: { ...(doc.nodes.r1 as object), filter: { blur: 4 } } as never } };
    const second = setup({ id: "r1", doc: filtered , open: ["effects"] });
    await user.clear(box("Filter: Blur"));
    await user.keyboard("{Enter}");
    expect(second.onApply).toHaveBeenCalledWith([{ op: "update", id: "r1", props: { filter: null } }], "effects");
  });

  it("starts an outline with defaults", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ id: "r1", open: ["effects"] });
    await user.click(screen.getByRole("button", { name: /^Outline ?none/ }));
    await user.type(await screen.findByRole("textbox", { name: "Value" }), "#00ff00{Enter}");
    expect(onApply).toHaveBeenCalledWith([{ op: "update", id: "r1", props: { outline: { color: "#00ff00", width: 1, style: "solid", offset: 0 } } }], "effects");
  });
});

describe("Page", () => {
  it("renames the page with a page label", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ id: "p1" });
    await user.clear(box("Name"));
    await user.type(box("Name"), "Cover v2{Enter}");
    expect(onApply).toHaveBeenCalledWith([{ op: "update", id: "p1", props: { name: "Cover v2" } }], "rename page");
  });

  it("sets the theme mode from the document modes", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ id: "p1" });
    await choose(user, "Theme mode", "dark");
    expect(onApply).toHaveBeenCalledWith([{ op: "update", id: "p1", props: { mode: "dark" } }], "theme mode");
  });

  it("sets the page background and notes", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ id: "p1" });
    await user.click(screen.getByRole("button", { name: /^Background ?(rgb|none|#|\$)/ }));
    await user.type(await screen.findByRole("textbox", { name: "Value" }), "#fafafa{Enter}");
    expect(onApply).toHaveBeenCalledWith([{ op: "update", id: "p1", props: { fill: "#fafafa" } }], "page background");
  });
});

describe("Document", () => {
  const activity: ActivityEntry[] = [
    { id: "a1", author: "claude", tone: "agent-1", label: "update_nodes · Title", time: "now", batch: true },
    { id: "a2", author: "you", label: "undo · move", time: "1 min", undone: true },
  ];

  it("renames the workspace and rejects an empty name", async () => {
    const user = userEvent.setup();
    const { onApply } = setup();
    await user.clear(box("Name"));
    await user.keyboard("{Enter}");
    expect(screen.getByText("The name cannot be empty.")).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
    await user.clear(box("Name"));
    await user.type(box("Name"), "New name{Enter}");
    expect(onApply).toHaveBeenCalledWith([{ op: "rename_document", name: "New name" }], "rename workspace");
  });

  it("edits a token value and deletes it when emptied", async () => {
    const user = userEvent.setup();
    const { onApply } = setup();
    await user.clear(box("$gap"));
    await user.type(box("$gap"), "12{Enter}");
    expect(onApply).toHaveBeenLastCalledWith([{ op: "set_tokens", tokens: { gap: 12 } }], "token");
    await user.clear(box("$brand"));
    await user.keyboard("{Enter}");
    expect(onApply).toHaveBeenLastCalledWith([{ op: "set_tokens", tokens: { brand: null } }], "token");
  });

  it("creates a token from an assignment, with type and collection", async () => {
    const user = userEvent.setup();
    const { onApply } = setup();
    await user.type(box("New token"), "core/color accent = #112233{Enter}");
    expect(onApply).toHaveBeenCalledWith([{ op: "set_tokens", tokens: { accent: "#112233" }, type: "color", collection: "core" }], "token");
    expect(box("New token")).toHaveValue("");
  });

  it("explains an invalid assignment and keeps the text", async () => {
    const user = userEvent.setup();
    const { onApply } = setup();
    await user.type(box("New token"), "oops{Enter}");
    expect(screen.getByText("Use name = value.")).toBeInTheDocument();
    expect(box("New token")).toHaveValue("oops");
    expect(onApply).not.toHaveBeenCalled();
  });

  it("creates and edits mode tokens", async () => {
    const user = userEvent.setup();
    const { onApply } = setup();
    await user.type(box("New mode token"), "dark: bg = #14161f{Enter}");
    expect(onApply).toHaveBeenLastCalledWith([{ op: "set_tokens", mode: "dark", tokens: { bg: "#14161f" } }], "mode token");
    await user.clear(box("dark · $brand"));
    await user.type(box("dark · $brand"), "#000000{Enter}");
    expect(onApply).toHaveBeenLastCalledWith([{ op: "set_tokens", mode: "dark", tokens: { brand: "#000000" } }], "mode token");
  });

  it("lists review problems and selects the node on click", async () => {
    const user = userEvent.setup();
    const lint: LintIssue[] = [
      { rule: "contrast", severity: "error", nodeId: "t1", message: "Low contrast" },
      { rule: "overflow", severity: "warning", nodeId: "f1", message: "Overflows" },
    ];
    const { onSelect } = setup({ lint });
    expect(screen.getByLabelText("2 problems")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Contrast Low contrast/ }));
    expect(onSelect).toHaveBeenCalledWith(["t1"]);
  });

  it("shows the empty and the pending review states", async () => {
    const user = userEvent.setup();
    const first = setup({ lint: [] });
    await user.click(screen.getByRole("button", { name: /Review/ }));
    expect(screen.getByText("No contrast, overflow or token problems.")).toBeInTheDocument();
    first.unmount();
    setup();
    await user.click(screen.getByRole("button", { name: /Review/ }));
    expect(screen.getByText("Checking the document…")).toBeInTheDocument();
  });

  it("renders the activity with batches, undone steps and the now marker", () => {
    setup({ activity, activityMarker: 1 });
    const list = screen.getByRole("list", { name: "Activity" });
    expect(within(list).getByText("update_nodes · Title")).toBeInTheDocument();
    expect(within(list).getByText("undone")).toBeInTheDocument();
    expect(within(list).getByLabelText("now")).toBeInTheDocument();
  });

  it("shows an empty activity", () => {
    setup({ activity: [] });
    expect(screen.getByText("No edits yet.")).toBeInTheDocument();
  });
});

describe("Multi selection", () => {
  it("wraps in a frame, applies the op and selects the new frame", async () => {
    const user = userEvent.setup();
    const { onApply, onSelect } = setup({ id: ["r2", "r3"] });
    await user.click(screen.getByRole("button", { name: "Wrap in frame" }));
    const [ops, label] = onApply.mock.calls[0] as [{ op: string; ids: string[]; id: string }[], string];
    expect(label).toBe("wrap in frame");
    expect(ops[0]).toMatchObject({ op: "wrap", ids: ["r2", "r3"] });
    expect(onSelect).toHaveBeenCalledWith([ops[0]?.id]);
  });

  it("waits for an asynchronous owner before selecting the new group", async () => {
    const user = userEvent.setup();
    let accept: () => void = () => undefined;
    const onApply = vi.fn(() => new Promise<void>((resolve) => (accept = resolve)));
    const { onSelect } = setup({ id: ["r2", "r3"], onApply });
    await user.click(screen.getByRole("button", { name: "Group" }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
    await act(async () => accept());
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("does not select anything and reports the error when the owner refuses", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn(() => Promise.reject(new Error("refused")));
    const { onSelect, onError } = setup({ id: ["r2", "r3"], onApply });
    await user.click(screen.getByRole("button", { name: "Wrap in frame" }));
    await act(async () => undefined);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("refused");
  });

  it.each(emptyFailures)("reports the generic text when the owner refuses with %s", async (_, make) => {
    const user = userEvent.setup();
    const { onError } = setup({ id: ["r2", "r3"], onApply: vi.fn(() => Promise.reject(make())) });
    await user.click(screen.getByRole("button", { name: "Wrap in frame" }));
    await act(async () => undefined);
    expect(onError).toHaveBeenCalledWith("Unknown error");
  });

  it("shows only the shortcut hints the owner passes", () => {
    const first = setup({ id: ["r2", "r3"] });
    for (const name of ["Group", "Wrap in frame"]) expect(screen.getByRole("button", { name })).not.toHaveAttribute("title");
    first.unmount();
    setup({ id: ["r2", "r3"], shortcuts: { group: ["Mod", "G"] } });
    expect(screen.getByRole("button", { name: "Group" })).toHaveAttribute("title", "Mod+G");
    expect(screen.getByRole("button", { name: "Wrap in frame" })).not.toHaveAttribute("title");
  });

  it("groups free elements and selects the group", async () => {
    const user = userEvent.setup();
    const { onApply, onSelect } = setup({ id: ["r2", "r3"] });
    await user.click(screen.getByRole("button", { name: "Group" }));
    const [ops, label] = onApply.mock.calls[0] as [{ op: string; id: string }[], string];
    expect(label).toBe("group");
    expect(onSelect).toHaveBeenCalledWith([ops[0]?.id]);
  });

  it("reports an error when the structure cannot be grouped", async () => {
    const user = userEvent.setup();
    const { onApply, onError } = setup({ id: ["r1", "e1"] });
    await user.click(screen.getByRole("button", { name: "Group" }));
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("cannot be grouped"));
    expect(onApply).not.toHaveBeenCalled();
  });

  it("offers ungroup only when a group is selected", async () => {
    const user = userEvent.setup();
    const doc = withGroup(buildDocument());
    const first = setup({ id: ["g1", "r1"], doc });
    expect(screen.getByRole("button", { name: "Ungroup" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ungroup" }));
    expect(first.onApply.mock.calls[0]?.[0]).toEqual([{ op: "ungroup", ids: ["g1"] }]);
    expect(first.onSelect).toHaveBeenCalledWith(["r2", "r3"]);
    first.unmount();
    setup({ id: ["r1", "e1"] });
    expect(screen.queryByRole("button", { name: "Ungroup" })).not.toBeInTheDocument();
  });

  it("aligns and keeps distribution disabled for fewer than three elements", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ id: ["r2", "r3"] });
    expect(screen.getByRole("button", { name: "Distribute horizontally" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Align bottom" }));
    expect(onApply.mock.calls.length <= 1).toBe(true);
    await user.click(screen.getByRole("button", { name: "Align left" }));
    if (onApply.mock.calls.length) expect(onApply.mock.calls.at(-1)?.[1]).toMatch(/Align/);
  });

  it("reorders every selected element", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ id: ["r1", "e1"] });
    await user.click(screen.getByRole("button", { name: "Bring to front" }));
    expect(onApply).toHaveBeenCalledWith(
      [
        { op: "update", id: "r1", props: { index: "front" } },
        { op: "update", id: "e1", props: { index: "front" } },
      ],
      "Bring to front",
    );
  });
});

describe("Group, connector, component and instance", () => {
  it("edits a group and can ungroup it", async () => {
    const user = userEvent.setup();
    const doc = withGroup(buildDocument());
    const { onApply, onSelect } = setup({ id: "g1", doc });
    expect(screen.getByTestId("group-panel")).toBeInTheDocument();
    expect(screen.getByText(/the box follows its 2 children/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ungroup" }));
    expect(onApply).toHaveBeenCalledWith([{ op: "ungroup", ids: ["g1"] }], "ungroup");
    expect(onSelect).toHaveBeenCalledWith(["r2", "r3"]);
  });

  it("edits the route, the arrow and the label of a connector and jumps to an end", async () => {
    const user = userEvent.setup();
    const { onApply, onSelect } = setup({ id: "k1" });
    await choose(user, "Route", "elbow");
    expect(onApply).toHaveBeenLastCalledWith([{ op: "update", id: "k1", props: { route: "elbow" } }], "edit connector");
    await choose(user, "Start side", "top");
    expect(onApply).toHaveBeenLastCalledWith([{ op: "update", id: "k1", props: { from: { nodeId: "r1", side: "top" } } }], "edit connector");
    await user.type(box("Label"), "yes{Enter}");
    expect(onApply).toHaveBeenLastCalledWith([{ op: "update", id: "k1", props: { label: "yes" } }], "edit label");
    await user.click(screen.getByRole("button", { name: "Button" }));
    expect(onSelect).toHaveBeenCalledWith(["r1"]);
  });

  it("turns a frame into a component and creates an instance beside it", async () => {
    const user = userEvent.setup();
    const first = setup({ id: "f2", open: ["component"] });
    await user.click(screen.getByRole("button", { name: "Make component" }));
    expect(first.onApply).toHaveBeenCalledWith([{ op: "update", id: "f2", props: { component: true } }], "make component");
    first.unmount();
    const second = setup({ id: "c1", open: ["component"] });
    await user.click(screen.getByRole("button", { name: "New instance" }));
    const [ops, label] = second.onApply.mock.calls[0] as [{ op: string; node: { instanceOf: string; x: number } }[], string];
    expect(label).toBe("create instance");
    expect(ops[0]).toMatchObject({ op: "create", node: { instanceOf: "c1", x: 240 } });
    expect(second.onSelect).toHaveBeenCalledOnce();
  });

  it("adds and removes component props, moving focus to the add button", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ id: "c1", open: ["component"] });
    await user.click(screen.getByRole("button", { name: "New property" }));
    expect((onApply.mock.calls[0] as [{ props: { componentProps: unknown[] } }[]])[0][0]?.props.componentProps).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Remove property 1" }));
    expect((onApply.mock.calls[1] as [{ props: { componentProps: unknown[] } }[]])[0][0]?.props.componentProps).toEqual([]);
    expect(screen.getByRole("button", { name: "New property" })).toHaveFocus();
  });

  it("validates the name of a component prop", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ id: "c1", open: ["component"] });
    await user.clear(box("Property name"));
    await user.type(box("Property name"), "1bad{Enter}");
    expect(screen.getByText("Use letters, digits and underscores, starting with a letter.")).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("shows an instance with its values, scale and detach", async () => {
    const user = userEvent.setup();
    const { onApply, onSelect } = setup({ id: "i1" });
    expect(screen.getByTestId("instance-panel")).toBeInTheDocument();
    await user.clear(box("label"));
    await user.type(box("label"), "Hello{Enter}");
    expect(onApply).toHaveBeenLastCalledWith([{ op: "update", id: "i1", props: { propValues: { label: "Hello" } } }], "instance property");
    await user.clear(box("Scale"));
    await user.type(box("Scale"), "2{Enter}");
    expect(onApply).toHaveBeenLastCalledWith([{ op: "update", id: "i1", props: { scale: 2 } }], "edit instance");
    await user.click(screen.getByRole("button", { name: "Detach" }));
    expect(onApply).toHaveBeenLastCalledWith([{ op: "detach", ids: ["i1"] }], "detach instance");
    await user.click(screen.getByRole("button", { name: "Go to component" }));
    expect(onSelect).toHaveBeenCalledWith(["c1"]);
  });

  it("binds a child of a component to its props", async () => {
    const user = userEvent.setup();
    const doc = buildDocument();
    const { applyOps } = await import("@paprika/core");
    const bound = applyOps(doc, [{ op: "create", parentId: "c1", node: { type: "text", id: "ct", name: "Label", text: "Hi" } }]).doc;
    const { onApply } = setup({ id: "ct", doc: bound });
    await choose(user, "Text", "label");
    expect(onApply).toHaveBeenLastCalledWith([{ op: "update", id: "ct", props: { bind: { text: "label" } } }], "bind");
  });

  it("detaches the tokens a node uses and moves focus inside the panel", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ id: "t1" });
    await user.click(screen.getByRole("button", { name: "Detach tokens from this element" }));
    expect(onApply).toHaveBeenCalledWith([{ op: "detach_tokens", ids: ["t1"] }], "detach token");
    expect(screen.getByRole("complementary", { name: "Properties" })).toHaveFocus();
  });

  it("detaches one token use", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ id: "t1" });
    await user.click(screen.getByRole("button", { name: "Detach Color" }));
    expect(onApply).toHaveBeenCalledWith([{ op: "detach_tokens", ids: ["t1"], fields: ["color"] }], "detach token");
  });

  it("shows a copy inside an instance as read only with links", async () => {
    const user = userEvent.setup();
    const { applyOps } = await import("@paprika/core");
    const doc = buildDocument();
    const withChild = applyOps(doc, [{ op: "create", parentId: "c1", node: { type: "text", id: "ct", name: "Label", text: "Hi" } }]).doc;
    const copyId = Object.keys(withChild.nodes).find((id) => withChild.nodes[id]?.parentId === "i1");
    expect(copyId).toBeDefined();
    const { onSelect } = setup({ id: copyId as string, doc: withChild });
    expect(screen.getByTestId("copy-panel")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Go to instance" }));
    expect(onSelect).toHaveBeenCalledWith(["i1"]);
  });

  it("edits what a copy may override, in percent for opacity, and restores it from the component", async () => {
    const user = userEvent.setup();
    const base = applyOps(buildDocument(), [{ op: "create", parentId: "c1", node: { type: "text", id: "ct", name: "Label", text: "Hi" } }]).doc;
    const copyId = Object.keys(base.nodes).find((id) => base.nodes[id]?.parentId === "i1") as string;
    const first = setup({ id: copyId, doc: base });
    await user.clear(box("Content"));
    await user.type(box("Content"), "Bye");
    await user.tab();
    expect(first.onApply).toHaveBeenLastCalledWith([{ op: "update", id: copyId, props: { text: "Bye" } }], "override");
    await user.clear(box("Opacity"));
    await user.type(box("Opacity"), "50{Enter}");
    expect(first.onApply).toHaveBeenLastCalledWith([{ op: "update", id: copyId, props: { opacity: 0.5 } }], "override");
    await choose(user, "Visible", "no");
    expect(first.onApply).toHaveBeenLastCalledWith([{ op: "update", id: copyId, props: { visible: false } }], "override");
    expect(screen.queryByRole("button", { name: "Restore from component" })).not.toBeInTheDocument();
    first.unmount();
    const overridden = applyOps(base, [{ op: "update", id: copyId, props: { text: "Bye", opacity: 0.5 } }]).doc;
    const second = setup({ id: copyId, doc: overridden });
    await user.click(screen.getByRole("button", { name: "Restore from component" }));
    const call = second.onApply.mock.calls[0] as [{ props: Record<string, unknown> }[], string];
    expect(Object.values(call[0][0]?.props ?? {}).every((value) => value === null)).toBe(true);
    expect(Object.keys(call[0][0]?.props ?? {}).sort()).toEqual(["opacity", "text"]);
  });

  it("shows the connector opacity in percent", () => {
    setup({ id: "k1" });
    expect(box("Opacity")).toHaveValue("100");
  });

  it("edits notes", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ id: "f1" });
    await user.click(screen.getByRole("button", { name: "Notes for agents" }));
    await user.type(await screen.findByRole("textbox", { name: "Notes" }), "keep it calm{Enter}");
    expect(onApply).toHaveBeenCalledWith([{ op: "update", id: "f1", props: { notes: "keep it calm" } }], "notes");
  });
});

describe("Content and web sections", () => {
  it("aligns and centers the content of a frame", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ id: "f1" });
    await user.click(screen.getByRole("radio", { name: "Center horizontally" }));
    expect(onApply.mock.calls[0]?.[1]).toBe("align content");
    await user.click(screen.getByRole("button", { name: "Center" }));
    expect(onApply.mock.calls.at(-1)?.[1]).toBe("center content");
  });

  it("shows the center shortcut only when the owner passes it", () => {
    const first = setup({ id: "f2" });
    expect(screen.queryByText("Alt")).not.toBeInTheDocument();
    first.unmount();
    setup({ id: "f2", shortcuts: { center: ["Alt", "C"] } });
    expect(screen.getByText("Alt")).toBeInTheDocument();
  });

  it("edits the link of a frame", async () => {
    const user = userEvent.setup();
    const { onApply } = setup({ id: "f1" });
    await user.click(screen.getByRole("button", { name: "Web" }));
    await user.type(await screen.findByRole("textbox", { name: "Link" }), "#top{Enter}");
    expect(onApply).toHaveBeenCalledWith([{ op: "update", id: "f1", props: { href: "#top" } }], "link");
  });
});

describe("Image, vector and shape", () => {
  it("edits an image, a path and a shape through their sections", async () => {
    const user = userEvent.setup();
    const { applyOps } = await import("@paprika/core");
    const doc = applyOps(buildDocument(), [
      { op: "create", parentId: "f2", node: { type: "image", id: "im", name: "Pic", src: "https://x.test/a.png", alt: "A" } },
      { op: "create", parentId: "f2", node: { type: "path", id: "pa", name: "Vec", d: "M0 0 L10 10" } },
      { op: "create", parentId: "f2", node: { type: "shape", id: "sh", name: "Box", shape: "rect", text: "x" } },
    ]).doc;
    const image = setup({ id: "im", doc });
    await user.clear(box("Alternative text"));
    await user.type(box("Alternative text"), "B{Enter}");
    expect(image.onApply).toHaveBeenCalledWith([{ op: "update", id: "im", props: { alt: "B" } }], "edit image");
    image.unmount();
    const path = setup({ id: "pa", doc });
    await choose(user, "Fill rule", "evenodd");
    expect(path.onApply).toHaveBeenCalledWith([{ op: "update", id: "pa", props: { fillRule: "evenodd" } }], "edit vector");
    path.unmount();
    const shape = setup({ id: "sh", doc });
    await choose(user, "Shape type", "oval");
    expect(shape.onApply).toHaveBeenCalledWith([{ op: "update", id: "sh", props: { shape: "ellipse" } }], "change shape");
  });
});

it("re-renders with a new node without keeping a stale draft", async () => {
  const user = userEvent.setup();
  const doc = buildDocument();
  const { rerender } = render(<PropertiesPanel doc={doc} node={doc.nodes.f1 ?? null} selected={["f1"]} onApply={() => {}} onSelect={() => {}} />);
  await user.click(box("X"));
  await user.keyboard("{Control>}a{/Control}5");
  rerender(<PropertiesPanel doc={doc} node={doc.nodes.f2 ?? null} selected={["f2"]} onApply={() => {}} onSelect={() => {}} />);
  expect(box("X")).toHaveValue("700");
  await act(async () => {});
});

describe("Layout of the node panel", () => {
  const titles = () => screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent?.trim());

  it("orders the sections as the design does: position, fill, auto layout, effects, component, web", () => {
    setup({ id: "f1" });
    const order = titles();
    const at = (title: string) => order.findIndex((text) => text?.startsWith(title));
    const wanted = ["Position and size", "Fill and border", "Auto layout", "Effects", "Component", "Web"].map(at);
    expect(wanted.every((index) => index >= 0)).toBe(true);
    expect([...wanted].sort((a, b) => a - b)).toEqual(wanted);
  });

  it("labels the fill and the border above their color fields", () => {
    const doc = applyOps(buildDocument(), [{ op: "update", id: "f1", props: { stroke: { color: "rgb(0, 0, 0)", width: 1 } } }]).doc;
    setup({ id: "f1", doc });
    expect(screen.getByText("Fill", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("Border", { selector: "p" })).toBeInTheDocument();
  });
});

describe("Typed property names", () => {
  it("refuses a property that no node has", () => {
    const set: SetProps = () => undefined;
    set({ x: 1, layout: null });
    // @ts-expect-error a misspelled property name does not compile
    set({ widht: 1 });
  });
});

describe("PropertiesPanel activity time", () => {
  it("accepts an element as the time, so the owner can give each row its own clock", () => {
    setup({ activity: [{ id: "a", author: "claude", label: "mover", time: <time data-testid="own-clock">3 min</time> }] });
    expect(screen.getByTestId("own-clock")).toHaveTextContent("3 min");
  });
});
