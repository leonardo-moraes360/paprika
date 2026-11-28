import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { EditorHeader, type EditorHeaderProps } from "./index";

const path = [{ label: "Studio North", onSelect: vi.fn() }, { label: "App redesign", onSelect: vi.fn() }, { label: "Cover" }];

function setup(props: Partial<EditorHeaderProps> = {}) {
  const handlers = { onLanguageChange: vi.fn(), onThemeChange: vi.fn() };
  const view = render(<EditorHeader path={path} connected language="en" theme="system" {...handlers} {...props} />);
  return { ...handlers, ...view };
}

afterEach(async () => {
  await i18n.changeLanguage("en");
  document.documentElement.removeAttribute("data-theme");
});

describe("EditorHeader", () => {
  it("renders the brand, the path with the current page marked and the connection", () => {
    setup();
    const header = screen.getByRole("banner", { name: "Editor header" });
    expect(within(header).getByRole("img", { name: "Paprika" })).toBeInTheDocument();
    const nav = within(header).getByRole("navigation", { name: "Document path" });
    expect(within(nav).getByText("Cover")).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("button", { name: "Studio North" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Connected");
  });

  it("hides the pins, agents and team chips when there is nothing to show", () => {
    setup({ pins: 0, agents: 0, team: null, onPinsClick: vi.fn(), onAgentsClick: vi.fn(), onTeamClick: vi.fn() });
    expect(screen.queryByText(/open|active|online/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open pin/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Agents:/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show team/ })).not.toBeInTheDocument();
  });

  it("emits the chip clicks", async () => {
    const user = userEvent.setup();
    const onPinsClick = vi.fn();
    const onAgentsClick = vi.fn();
    const onTeamClick = vi.fn();
    setup({ pins: 2, agents: 3, team: { name: "Studio North", online: 2 }, onPinsClick, onAgentsClick, onTeamClick });
    await user.click(screen.getByRole("button", { name: "Show 2 open pins" }));
    await user.click(screen.getByRole("button", { name: "Agents: 3 active" }));
    await user.click(screen.getByRole("button", { name: "Show team Studio North" }));
    expect(onPinsClick).toHaveBeenCalledOnce();
    expect(onAgentsClick).toHaveBeenCalledOnce();
    expect(onTeamClick).toHaveBeenCalledOnce();
    expect(screen.getByText("Studio North · 2 online")).toBeInTheDocument();
    expect(screen.getByText("2 open")).toBeInTheDocument();
    expect(screen.getByText("3 active")).toBeInTheDocument();
  });

  it("uses the singular for one open pin and marks the agents trigger as expanded", () => {
    setup({ pins: 1, agents: 1, agentsOpen: true, onPinsClick: vi.fn() });
    expect(screen.getByRole("button", { name: "Show 1 open pin" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agents: 1 active" })).toHaveAttribute("aria-expanded", "true");
  });

  it("lets the owner wrap the agents trigger", () => {
    setup({ agents: 2, renderAgents: (trigger) => <div data-testid="roster">{trigger}</div> });
    expect(within(screen.getByTestId("roster")).getByRole("button", { name: "Agents: 2 active" })).toBeInTheDocument();
  });

  it("shows the disconnected state in a status chip", () => {
    setup({ connected: false, connectionLabel: "v0.9.2" });
    expect(screen.getByRole("status")).toHaveTextContent("Disconnected");
    expect(screen.getByRole("status")).not.toHaveAttribute("data-connected");
  });

  it("shows the owner's connection label when connected", () => {
    setup({ connectionLabel: "v0.9.2 · MCP at /mcp" });
    expect(screen.getByRole("status")).toHaveTextContent("v0.9.2 · MCP at /mcp");
  });

  it("navigates the path through the callback of each crumb", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "App redesign" }));
    expect(path[1]?.onSelect).toHaveBeenCalledOnce();
    expect(path[0]?.onSelect).not.toHaveBeenCalled();
  });

  it("renders a crumb as the owner's link", () => {
    setup({ path: [{ label: "Home", render: <a href="/overview" data-testid="owner-link" /> }, { label: "Cover" }] });
    expect(screen.getByTestId("owner-link")).toHaveAttribute("href", "/overview");
    expect(screen.getByTestId("owner-link")).toHaveTextContent("Home");
  });

  it("emits the language and returns focus to the trigger, without changing the app language", async () => {
    const user = userEvent.setup();
    const change = vi.spyOn(i18n, "changeLanguage");
    const { onLanguageChange } = setup();
    const trigger = screen.getByRole("button", { name: "Language: EN" });
    expect(trigger).toHaveTextContent("EN");
    await user.click(trigger);
    await user.click(screen.getByRole("menuitemradio", { name: "Português (Brasil)" }));
    expect(onLanguageChange).toHaveBeenCalledWith("pt-BR");
    expect(change).not.toHaveBeenCalled();
    expect(i18n.language).toBe("en");
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
  });

  it("marks the current language and shows its short code", async () => {
    const user = userEvent.setup();
    setup({ language: "pt-BR" });
    const trigger = screen.getByRole("button", { name: "Language: PT" });
    expect(trigger).toHaveTextContent("PT");
    await user.click(trigger);
    expect(screen.getByRole("menuitemradio", { name: "Português (Brasil)" })).toBeChecked();
  });

  it("emits the theme and leaves data-theme to the owner", async () => {
    const user = userEvent.setup();
    const { onThemeChange } = setup({ theme: "light" });
    expect(screen.getByRole("radio", { name: "Light" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "Dark" }));
    expect(onThemeChange).toHaveBeenCalledWith("dark");
    expect(document.documentElement).not.toHaveAttribute("data-theme");
  });

  it("renders in Portuguese with plurals", async () => {
    await i18n.changeLanguage("pt-BR");
    setup({ pins: 2, agents: 3, connected: false, team: { name: "Estúdio Norte", online: 2 }, onTeamClick: vi.fn() });
    expect(screen.getByRole("banner", { name: "Cabeçalho do editor" })).toBeInTheDocument();
    expect(screen.getByText("2 abertos")).toBeInTheDocument();
    expect(screen.getByText("3 ativos")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("desconectado");
    expect(screen.getByRole("button", { name: "Mostrar o time Estúdio Norte" })).toBeInTheDocument();
  });

  it("opens the language menu from the end side in a right-to-left page", async () => {
    const user = userEvent.setup();
    render(
      <div dir="rtl">
        <EditorHeader path={path} connected language="en" theme="dark" onLanguageChange={vi.fn()} onThemeChange={vi.fn()} />
      </div>,
    );
    await user.click(screen.getByRole("button", { name: "Language: EN" }));
    expect(screen.getByRole("menuitemradio", { name: "English" })).toBeInTheDocument();
  });
});
