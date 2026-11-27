import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { EditorLayout, editorLayoutDefaults, type EditorLayoutProps, type EditorLayoutValue } from "./index";

beforeAll(() => {
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => null });
});

function rect(x: number, width: number) {
  return { x, y: 0, top: 0, left: x, right: x + width, bottom: 600, width, height: 600, toJSON: () => ({}) } as DOMRect;
}

function stubWidths(widths: Record<string, number> = { "-left": 248, "-center": 1000, "-right": 320 }) {
  const widthOf = (suffix: string) => widths[suffix] ?? 0;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const key = Object.keys(widths).find((suffix) => this.id.endsWith(suffix));
    if (key) return rect(0, widthOf(key));
    if (this.getAttribute("data-slot") === "resizable-handle") {
      const index = Array.from(document.querySelectorAll("[data-slot=resizable-handle]")).indexOf(this);
      return rect(index === 0 ? widthOf("-left") : widthOf("-left") + widthOf("-center"), 1);
    }
    return rect(5000, 0);
  });
}

async function setup(props: Partial<EditorLayoutProps> = {}) {
  stubWidths();
  const view = render(
    <EditorLayout left={<button>in-left</button>} center={<p>canvas</p>} right={<button>in-right</button>} {...props} />,
  );
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

const separators = () => screen.getAllByRole("separator");
const sep = (index: 0 | 1) => separators()[index] as HTMLElement;
const leftHandle = () => screen.getByRole("button", { name: /layers panel/ });
const rightHandle = () => screen.getByRole("button", { name: /properties panel/ });
const panel = (side: "left" | "center" | "right") => document.getElementById(`editor-layout-${side}`) as HTMLElement;
const stored = () => window.localStorage.getItem("paprika.ui-sdk-resizable:editor");

describe("EditorLayout", () => {
  it("renders the three slots with named regions and separators", async () => {
    await setup();
    expect(screen.getByRole("complementary", { name: "Layers panel" })).toHaveTextContent("in-left");
    expect(screen.getByRole("complementary", { name: "Properties panel" })).toHaveTextContent("in-right");
    expect(screen.getByText("canvas")).toBeInTheDocument();
    expect(separators()).toHaveLength(2);
    expect(sep(0)).toHaveAccessibleName("Resize layers panel");
    expect(sep(1)).toHaveAccessibleName("Resize properties panel");
    expect(sep(0)).toHaveAttribute("aria-controls", "editor-layout-left");
  });

  it("starts at the design widths in pixels", async () => {
    await setup();
    expect(panel("left").style.flex).toContain("248px");
    expect(panel("right").style.flex).toContain("320px");
    expect(editorLayoutDefaults.left).toEqual({ min: 200, max: 480, initial: 248 });
    expect(editorLayoutDefaults.right).toEqual({ min: 240, max: 480, initial: 320 });
  });

  it("takes sizes and the initial width by props", async () => {
    await setup({ leftSize: { min: 100, max: 300, initial: 150 }, defaultValue: { right: 9999 }, rightSize: { min: 240, max: 400, initial: 320 } });
    expect(panel("left").style.flex).toContain("150px");
    expect(panel("right").style.flex).toContain("400px");
  });

  it("moves a separator with the arrow keys and reports the pixels once, on commit", async () => {
    const user = userEvent.setup();
    const onValueCommit = vi.fn();
    const onValueChange = vi.fn();
    await setup({ onValueCommit, onValueChange });
    sep(0).focus();
    const before = Number(sep(0).getAttribute("aria-valuenow"));
    await user.keyboard("{ArrowRight}");
    expect(Number(sep(0).getAttribute("aria-valuenow"))).toBeGreaterThan(before);
    expect(onValueChange).toHaveBeenCalled();
    expect(onValueCommit).toHaveBeenCalledTimes(1);
    const value = onValueCommit.mock.calls[0]?.[0] as EditorLayoutValue;
    expect(value.left).toBeGreaterThan(248);
    expect(value.right).toBe(320);
    expect(value.leftCollapsed).toBe(false);
  });

  it("hides and shows a panel with its handle, with the label and aria-expanded following", async () => {
    const user = userEvent.setup();
    const onValueCommit = vi.fn();
    await setup({ onValueCommit });
    expect(leftHandle()).toHaveAttribute("aria-expanded", "true");
    expect(leftHandle()).toHaveAccessibleName("Hide layers panel");
    expect(leftHandle()).toHaveAttribute("aria-controls", "editor-layout-left");
    await user.click(leftHandle());
    expect(leftHandle()).toHaveAttribute("aria-expanded", "false");
    expect(leftHandle()).toHaveAccessibleName("Show layers panel");
    expect(panel("left")).toHaveAttribute("inert");
    expect(panel("left")).toHaveAttribute("data-collapsed");
    expect(onValueCommit).not.toHaveBeenCalled();
    await user.click(leftHandle());
    expect(leftHandle()).toHaveAttribute("aria-expanded", "true");
    expect(panel("left")).not.toHaveAttribute("inert");
    expect(rightHandle()).toHaveAttribute("aria-expanded", "true");
  });

  it("collapses with Enter on the separator and keeps the handle in sync", async () => {
    const user = userEvent.setup();
    await setup();
    sep(1).focus();
    await user.keyboard("{Enter}");
    expect(rightHandle()).toHaveAttribute("aria-expanded", "false");
    expect(panel("right")).toHaveAttribute("inert");
    expect(sep(1)).toHaveFocus();
  });

  it("moves the focus to the handle when the collapsed panel held it", async () => {
    await setup();
    screen.getByRole("button", { name: "in-left" }).focus();
    act(() => leftHandle().click());
    expect(leftHandle()).toHaveAttribute("aria-expanded", "false");
    expect(leftHandle()).toHaveFocus();
  });

  it("does not steal focus when collapsing from the handle itself", async () => {
    const user = userEvent.setup();
    await setup();
    await user.click(leftHandle());
    expect(leftHandle()).toHaveFocus();
    expect(screen.getByRole("button", { name: "in-right" })).not.toHaveFocus();
  });

  it("saves the layout under the paprika prefix on commit and restores it", async () => {
    const user = userEvent.setup();
    const { unmount } = await setup({ storageKey: "editor" });
    expect(stored()).toBeNull();
    sep(0).focus();
    await user.keyboard("{ArrowRight}");
    const saved = stored();
    expect(saved).not.toBeNull();
    const value = Number(sep(0).getAttribute("aria-valuenow"));
    unmount();
    await setup({ storageKey: "editor" });
    expect(Number(sep(0).getAttribute("aria-valuenow"))).toBeCloseTo(value, 0);
  });

  it("restores a collapsed panel and shows its handle collapsed", async () => {
    const user = userEvent.setup();
    const { unmount } = await setup({ storageKey: "editor" });
    sep(0).focus();
    await user.keyboard("{Enter}");
    expect(leftHandle()).toHaveAttribute("aria-expanded", "false");
    unmount();
    await setup({ storageKey: "editor" });
    expect(leftHandle()).toHaveAttribute("aria-expanded", "false");
    expect(panel("left")).toHaveAttribute("inert");
  });

  it("works when storage is blocked", async () => {
    const blocked = vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("denied");
    });
    try {
      const user = userEvent.setup();
      await setup({ storageKey: "editor" });
      sep(0).focus();
      await user.keyboard("{ArrowRight}");
      expect(Number(sep(0).getAttribute("aria-valuenow"))).toBeGreaterThan(16);
    } finally {
      blocked.mockRestore();
    }
  });

  describe("controlled", () => {
    const base: EditorLayoutValue = { left: 248, right: 320, leftCollapsed: false, rightCollapsed: false };

    it("follows the value from the owner and never persists", async () => {
      const { rerender } = await setup({ value: base, storageKey: "editor" });
      const initial = Number(sep(0).getAttribute("aria-valuenow"));
      rerender(<EditorLayout left={<p>L</p>} center={<p>C</p>} right={<p>R</p>} value={{ ...base, left: 400 }} storageKey="editor" />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(Number(sep(0).getAttribute("aria-valuenow"))).toBeGreaterThan(initial);
      rerender(<EditorLayout left={<p>L</p>} center={<p>C</p>} right={<p>R</p>} value={{ ...base, leftCollapsed: true }} storageKey="editor" />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(document.getElementById("editor-layout-left")).toHaveAttribute("inert");
      expect(stored()).toBeNull();
    });

    it("goes back to the owner value when the owner ignores a commit", async () => {
      const user = userEvent.setup();
      const onValueCommit = vi.fn();
      await setup({ value: base, onValueCommit });
      const initial = Number(sep(0).getAttribute("aria-valuenow"));
      sep(0).focus();
      await user.keyboard("{ArrowRight}");
      expect(onValueCommit).toHaveBeenCalledTimes(1);
      expect(Number(sep(0).getAttribute("aria-valuenow"))).toBeCloseTo(initial, 0);
    });

    it("does not move the focus when the owner refuses to collapse", async () => {
      await setup({ value: base });
      screen.getByRole("button", { name: "in-left" }).focus();
      act(() => leftHandle().click());
      expect(leftHandle()).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("button", { name: "in-left" })).toHaveFocus();
    });
  });

  it("takes complete labels by props and translates the defaults", async () => {
    await setup({ labels: { left: { hide: "Fechar camadas" } } });
    expect(screen.getByRole("button", { name: "Fechar camadas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide properties panel" })).toBeInTheDocument();
  });

  it("renders the default labels in pt-BR", async () => {
    await i18n.changeLanguage("pt-BR");
    try {
      await setup();
      expect(screen.getByRole("complementary", { name: "Painel de camadas" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Esconder painel de propriedades" })).toBeInTheDocument();
      expect(sep(0)).toHaveAccessibleName("Redimensionar painel de camadas");
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("mirrors the keys and the handles in right-to-left", async () => {
    const user = userEvent.setup();
    stubWidths();
    render(
      <div dir="rtl">
        <EditorLayout left={<p>L</p>} center={<p>C</p>} right={<p>R</p>} />
      </div>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    const before = Number(sep(0).getAttribute("aria-valuenow"));
    sep(0).focus();
    await user.keyboard("{ArrowLeft}");
    expect(Number(sep(0).getAttribute("aria-valuenow"))).toBeGreaterThan(before);
    expect(leftHandle()).toHaveAttribute("data-side", "start");
    expect(leftHandle().parentElement).toHaveClass("start-0");
    expect(rightHandle().parentElement).toHaveClass("end-0");
  });

  it("renders on the server", () => {
    const html = renderToString(<EditorLayout left={<p>L</p>} center={<p>C</p>} right={<p>R</p>} />);
    expect(html).toContain("Resize layers panel");
    expect(html).toContain("<p>C</p>");
  });

  it("ignores pointer events that are not from the main button", async () => {
    await setup();
    const before = sep(0).getAttribute("aria-valuenow");
    fireEvent.pointerDown(sep(0), { button: 2, clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(sep(0), { clientX: 200, pointerId: 1 });
    expect(sep(0).getAttribute("aria-valuenow")).toBe(before);
  });
});
