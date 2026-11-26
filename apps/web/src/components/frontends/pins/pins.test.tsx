import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { filterPins, NewPinForm, PinCard, PinsPanel, type NewPinFormProps, type PinCardProps, type PinEntry, type PinsPanelProps } from "./index";

const NOW = 10_000_000;

const pins: PinEntry[] = [
  { id: "x1", number: 1, status: "open", text: "The title breaks badly on mobile.", author: { name: "you", you: true }, createdAt: NOW - 8 * 60_000, target: { kind: "node", name: "Title" }, replies: [] },
  {
    id: "x2",
    number: 2,
    status: "claimed",
    text: "Make the button bigger.",
    author: { name: "you", you: true },
    createdAt: NOW - 3 * 60_000,
    target: { kind: "node", name: "Button" },
    claimedBy: { name: "claude", tone: "agent-1" },
    replies: [{ id: "r1", author: { name: "claude", tone: "agent-1" }, text: "Raised to 44 px.", createdAt: NOW - 5_000 }],
  },
  { id: "x3", number: 3, status: "resolved", text: "Fix the footer.", author: { name: "codex", tone: "agent-2" }, createdAt: NOW - 3_600_000, target: { kind: "area", width: 120.4, height: 48 }, replies: [] },
];

function panel(props: Partial<PinsPanelProps> = {}) {
  const handlers = { onSelectPin: vi.fn(), onFilterChange: vi.fn(), onClose: vi.fn() };
  const view = render(<PinsPanel pins={pins} now={NOW} {...handlers} {...props} />);
  return { ...handlers, ...view };
}

function card(props: Partial<PinCardProps> = {}) {
  const handlers = {
    onReply: vi.fn(() => Promise.resolve()),
    onSetStatus: vi.fn(() => Promise.resolve()),
    onDelete: vi.fn(() => Promise.resolve()),
    onShow: vi.fn(),
    onClose: vi.fn(),
  };
  const view = render(<PinCard pin={pins[1] as PinEntry} now={NOW} {...handlers} {...props} />);
  return { ...handlers, ...view };
}

function form(props: Partial<NewPinFormProps> = {}) {
  const handlers = { onSubmit: vi.fn(() => Promise.resolve()), onCancel: vi.fn() };
  const view = render(<NewPinForm number={4} target={{ kind: "node", name: "Title" }} {...handlers} {...props} />);
  return { ...handlers, ...view };
}

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const emptyFailures: [string, () => unknown][] = [["an empty message", () => new Error("")], ["no error value", () => undefined]];

describe("filterPins", () => {
  it("separates open, resolved and all", () => {
    expect(filterPins(pins, "open").map((p) => p.id)).toEqual(["x1", "x2"]);
    expect(filterPins(pins, "resolved").map((p) => p.id)).toEqual(["x3"]);
    expect(filterPins(pins, "all")).toHaveLength(3);
  });
});

describe("PinsPanel", () => {
  it("shows the open pins first with counts in the filter", () => {
    panel();
    expect(screen.getByRole("region", { name: "Pins" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Open 2" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Resolved 1" })).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0] as HTMLElement).getByText("you · 8 min ago · Title")).toBeInTheDocument();
    expect(within(items[1] as HTMLElement).getByText("you · 3 min ago · Button · claude")).toBeInTheDocument();
  });

  it("changes the filter and reports it", async () => {
    const user = userEvent.setup();
    const { onFilterChange } = panel();
    await user.click(screen.getByRole("radio", { name: "Resolved 1" }));
    expect(onFilterChange).toHaveBeenCalledWith("resolved");
    expect(screen.getByText("Fix the footer.")).toBeInTheDocument();
    expect(screen.getByText("codex · 1 h ago · Area 120 × 48")).toBeInTheDocument();
    expect(screen.queryByText("Make the button bigger.")).not.toBeInTheDocument();
  });

  it("follows a controlled filter without changing alone", async () => {
    const user = userEvent.setup();
    panel({ filter: "all" });
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    await user.click(screen.getByRole("radio", { name: "Open 2" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("selects a pin and marks the selected one", async () => {
    const user = userEvent.setup();
    const { onSelectPin } = panel({ selectedId: "x2" });
    await user.click(screen.getByRole("button", { name: /Make the button bigger/ }));
    expect(onSelectPin).toHaveBeenCalledWith("x2");
    expect(screen.getByRole("button", { name: /Make the button bigger/ })).toHaveAttribute("aria-current", "true");
  });

  it("shows an empty message and closes", async () => {
    const user = userEvent.setup();
    const { onClose } = panel({ pins: [] });
    expect(screen.getByText("No pins here.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders in pt-BR", async () => {
    await i18n.changeLanguage("pt-BR");
    try {
      panel();
      expect(screen.getByRole("region", { name: "Apontamentos" })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Abertos 2" })).toBeInTheDocument();
      expect(screen.getByText("você · há 8 min · Título".replace("Título", "Title"))).toBeInTheDocument();
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("renders on the server", () => {
    expect(renderToString(<PinsPanel pins={pins} now={NOW} onSelectPin={vi.fn()} />)).toContain("Pins");
  });
});

describe("PinCard", () => {
  it("shows text, status, target, work in progress and the thread", () => {
    card();
    expect(screen.getByText("Make the button bigger.")).toBeInTheDocument();
    expect(screen.getAllByText("claude").length).toBeGreaterThan(0);
    expect(screen.getByText("Button")).toBeInTheDocument();
    expect(screen.getByText("claude is working on this")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Replies" })).getByText("Raised to 44 px.")).toBeInTheDocument();
  });

  it("sends the reply with Enter, clears and keeps the focus", async () => {
    const user = userEvent.setup();
    const { onReply } = card();
    const input = screen.getByRole("textbox", { name: "Reply in the thread…" });
    await user.type(input, "Thanks{Enter}");
    expect(onReply).toHaveBeenCalledWith("Thanks");
    await act(async () => {});
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
  });

  it("drops the draft and the error when the owner swaps the pin", async () => {
    const user = userEvent.setup();
    const onReply = vi.fn(() => Promise.reject(new Error("offline")));
    const handlers = { onReply, onSetStatus: vi.fn(() => Promise.resolve()), onDelete: vi.fn(() => Promise.resolve()) };
    const { rerender } = render(<PinCard pin={pins[0] as PinEntry} now={NOW} {...handlers} />);
    await user.type(screen.getByRole("textbox"), "For the first{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    rerender(<PinCard pin={pins[1] as PinEntry} now={NOW} {...handlers} />);
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(screen.queryByRole("alert")).toBeNull();
    onReply.mockClear();
    await user.type(screen.getByRole("textbox"), "{Enter}");
    expect(onReply).not.toHaveBeenCalled();
  });

  it("does not send an empty reply", async () => {
    const user = userEvent.setup();
    const { onReply } = card();
    expect(screen.getByRole("button", { name: "Reply" })).toBeDisabled();
    await user.type(screen.getByRole("textbox"), "   {Enter}");
    expect(onReply).not.toHaveBeenCalled();
  });

  it("shows pending while the reply is saving and keeps the draft on error", async () => {
    const user = userEvent.setup();
    const pending = deferred();
    const onReply = vi.fn(() => pending.promise);
    card({ onReply });
    await user.type(screen.getByRole("textbox"), "Hi");
    await user.click(screen.getByRole("button", { name: "Reply" }));
    expect(onReply).toHaveBeenCalledOnce();
    expect(screen.getByRole("textbox")).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "Reply" })).toHaveAttribute("aria-busy", "true");
    await act(async () => {
      pending.reject(new Error("offline"));
      await pending.promise.catch(() => {});
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Could not save: offline");
    expect(screen.getByRole("textbox")).toHaveValue("Hi");
    expect(screen.getByRole("textbox")).toBeEnabled();
  });

  it("keeps the field enabled while Enter sends, so the focus cannot fall to the body", async () => {
    const user = userEvent.setup();
    const pending = deferred();
    card({ onReply: vi.fn(() => pending.promise) });
    const input = screen.getByRole("textbox");
    await user.type(input, "Hi{Enter}");
    expect(input).toBeEnabled();
    expect(input).toHaveAttribute("readonly");
    expect(input).toHaveAttribute("aria-busy", "true");
    expect(input).toHaveFocus();
    expect(screen.getByRole("button", { name: "Reply" })).toHaveAttribute("aria-busy", "true");
    await act(async () => {
      pending.resolve();
      await pending.promise;
    });
    expect(input).not.toHaveAttribute("readonly");
    expect(input).toHaveFocus();
  });

  it("cancels the draft with Escape first and closes with the next one", async () => {
    const user = userEvent.setup();
    const { onClose } = card();
    await user.type(screen.getByRole("textbox"), "draft{Escape}");
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("sends with Ctrl+Enter", async () => {
    const user = userEvent.setup();
    const { onReply } = card();
    await user.type(screen.getByRole("textbox"), "Now");
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(onReply).toHaveBeenCalledWith("Now");
  });

  it("resolves, reopens, deletes and shows on the canvas", async () => {
    const user = userEvent.setup();
    const { onSetStatus, onDelete, onShow, rerender, ...rest } = card();
    await user.click(screen.getByRole("button", { name: "Mark resolved" }));
    expect(onSetStatus).toHaveBeenCalledWith("resolved");
    await user.click(screen.getByRole("button", { name: "Delete pin" }));
    expect(onDelete).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Show on canvas" }));
    expect(onShow).toHaveBeenCalledOnce();
    rerender(<PinCard pin={pins[2] as PinEntry} now={NOW} onReply={rest.onReply} onSetStatus={onSetStatus} onDelete={onDelete} />);
    await user.click(screen.getByRole("button", { name: "Reopen" }));
    expect(onSetStatus).toHaveBeenLastCalledWith("open");
  });

  it("shows the error of a failed action", async () => {
    const user = userEvent.setup();
    card({ onSetStatus: vi.fn(() => Promise.reject(new Error("denied"))) });
    await user.click(screen.getByRole("button", { name: "Mark resolved" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save: denied");
    expect(screen.getByRole("button", { name: "Mark resolved" })).toHaveFocus();
  });

  it.each(emptyFailures)("shows the generic text when the failure has %s", async (_, make) => {
    const user = userEvent.setup();
    card({ onSetStatus: vi.fn(() => Promise.reject(make())) });
    await user.click(screen.getByRole("button", { name: "Mark resolved" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save: Unknown error");
  });
});

describe("NewPinForm", () => {
  it("sends the text, the recipient and the crop option", async () => {
    const user = userEvent.setup();
    const { onSubmit } = form({ recipients: [{ value: "claude", label: "claude" }] });
    expect(screen.getByText("Target: Title")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    await user.type(screen.getByRole("textbox"), "Break it in two lines");
    expect(screen.getByText("21/500")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Attach a crop of the area (PNG)" }));
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(onSubmit).toHaveBeenCalledWith({ text: "Break it in two lines", recipient: null, attachRegion: false });
  });

  it("submits with Ctrl+Enter and cancels with Escape", async () => {
    const user = userEvent.setup();
    const { onSubmit, onCancel } = form();
    expect(screen.getByRole("textbox")).toHaveFocus();
    await user.type(screen.getByRole("textbox"), "Do it");
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(onSubmit).toHaveBeenCalledOnce();
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("shows the submit shortcut hint only when the owner passes it", () => {
    const { unmount } = form();
    expect(screen.queryByText("Enter")).toBeNull();
    unmount();
    form({ submitShortcut: ["⌘", "Enter"] });
    expect(screen.getByText("⌘")).toBeInTheDocument();
    expect(screen.getByText("Enter")).toBeInTheDocument();
  });

  it.each(emptyFailures)("shows the generic text when sending fails with %s", async (_, make) => {
    const user = userEvent.setup();
    form({ onSubmit: vi.fn(() => Promise.reject(make())) });
    await user.type(screen.getByRole("textbox"), "Text");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save: Unknown error");
  });

  it("ignores Ctrl+Enter without text", async () => {
    const user = userEvent.setup();
    const { onSubmit } = form();
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows pending and then the error, keeping the text", async () => {
    const user = userEvent.setup();
    const pending = deferred();
    form({ onSubmit: vi.fn(() => pending.promise) });
    await user.type(screen.getByRole("textbox"), "Text");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(screen.getByRole("button", { name: "Send" })).toHaveAttribute("aria-busy", "true");
    await act(async () => {
      pending.reject(new Error("no connection"));
      await pending.promise.catch(() => {});
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Could not save: no connection");
    expect(screen.getByRole("textbox")).toHaveValue("Text");
  });

  it("lists references and removes one", async () => {
    const user = userEvent.setup();
    const onRemoveReference = vi.fn();
    form({ references: [{ id: "f1", kind: "image", name: "moodboard.png", detail: "PNG" }], onRemoveReference, onAttachReference: vi.fn() });
    await user.click(screen.getByRole("button", { name: "Remove moodboard.png" }));
    expect(onRemoveReference).toHaveBeenCalledWith("f1");
    expect(screen.getByRole("button", { name: "Attach" })).toBeInTheDocument();
  });

  it("renders in pt-BR", async () => {
    await i18n.changeLanguage("pt-BR");
    try {
      form();
      expect(screen.getByText("Novo apontamento")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Enviar" })).toBeInTheDocument();
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});
