import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { CanvasError, CanvasErrorScreen, type CanvasErrorProps } from "./index";

function Boom({ message = "Cannot read properties of undefined (reading 'children')" }: { message?: string }): never {
  throw new TypeError(message);
}

function silenceBoundaryLogs() {
  vi.spyOn(console, "error").mockImplementation(() => {});
}

function setup(props: Partial<CanvasErrorProps> = {}, child = <Boom />) {
  silenceBoundaryLogs();
  const onReload = vi.fn();
  const view = render(
    <CanvasError onReload={onReload} {...props}>
      {child}
    </CanvasError>,
  );
  return { onReload, ...view };
}

describe("CanvasError", () => {
  it("renders the children while nothing fails", () => {
    const onReload = vi.fn();
    render(
      <CanvasError onReload={onReload}>
        <p>canvas ok</p>
      </CanvasError>,
    );
    expect(screen.getByText("canvas ok")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the stopped screen with title, body and the reload button focused", () => {
    setup();
    const alert = screen.getByRole("alert");
    expect(within(alert).getByRole("heading", { level: 2, name: "The canvas stopped responding" })).toBeInTheDocument();
    expect(within(alert).getByText(/Your work is saved on the server/)).toBeInTheDocument();
    expect(within(alert).getByRole("button", { name: "Reload" })).toHaveFocus();
    expect(screen.queryByText("canvas ok")).not.toBeInTheDocument();
  });

  it("asks the owner to reload and never reloads by itself", async () => {
    const user = userEvent.setup();
    const { onReload } = setup();
    await user.click(screen.getByRole("button", { name: "Reload" }));
    expect(onReload).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("reports the caught error to the owner with the component stack", () => {
    const onError = vi.fn();
    setup({ onError });
    expect(onError).toHaveBeenCalled();
    const info = onError.mock.calls.at(-1)?.[0];
    expect(info).toMatchObject({ name: "TypeError", message: "Cannot read properties of undefined (reading 'children')" });
    expect(info.componentStack).toContain("Boom");
  });

  it("keeps the details collapsed and shows them, the environment and the copy button when opened", async () => {
    const user = userEvent.setup();
    setup({ environment: "Paprika v0.9.2 · WASM · Chrome 142" });
    expect(screen.queryByText(/TypeError: Cannot read/)).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "Technical details" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/TypeError: Cannot read properties of undefined/)).toBeVisible();
    expect(screen.getByText("Paprika v0.9.2 · WASM · Chrome 142")).toBeVisible();
  });

  it("copies the details with the environment to the clipboard and says so", async () => {
    const user = userEvent.setup();
    setup({ environment: "env line" });
    await user.click(screen.getByRole("button", { name: "Technical details" }));
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    await user.click(screen.getByRole("button", { name: "Copy details" }));
    expect(writeText).toHaveBeenCalledOnce();
    const copied = writeText.mock.calls[0]?.[0] as string;
    expect(copied.startsWith("TypeError: Cannot read properties of undefined (reading 'children')")).toBe(true);
    expect(copied.endsWith("\nenv line")).toBe(true);
    expect(await screen.findByText("Details copied to the clipboard.")).toBeInTheDocument();
  });

  it("says when the clipboard is not available", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Technical details" }));
    vi.stubGlobal("navigator", { clipboard: undefined });
    await user.click(screen.getByRole("button", { name: "Copy details" }));
    expect(await screen.findByText("Could not copy the details.")).toBeInTheDocument();
  });

  it("has no report button without a link or repository", () => {
    setup();
    expect(screen.queryByRole("link", { name: "Report on GitHub" })).not.toBeInTheDocument();
  });

  it("uses a ready-made link from the owner", () => {
    setup({ issueUrl: "https://github.com/leonardo/paprika/issues/new?template=canvas-crash.yml" });
    const link = screen.getByRole("link", { name: "Report on GitHub" });
    expect(link).toHaveAttribute("href", "https://github.com/leonardo/paprika/issues/new?template=canvas-crash.yml");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("builds the link from the repository with the pre-filled template and honours include in the report", async () => {
    const user = userEvent.setup();
    setup({ issue: { repository: "leonardo/paprika", template: "canvas-crash.yml", labels: ["bug"] }, environment: "Paprika v0.9.2" });
    const read = () => new URL(screen.getByRole("link", { name: "Report on GitHub" }).getAttribute("href") as string);
    let url = read();
    expect(url.pathname).toBe("/leonardo/paprika/issues/new");
    expect(url.searchParams.get("template")).toBe("canvas-crash.yml");
    expect(url.searchParams.get("title")).toBe("[canvas] The canvas stopped responding");
    expect(url.searchParams.get("labels")).toBe("bug");
    expect(url.searchParams.get("body")).toContain("What you were doing: (write here)");
    expect(url.searchParams.get("body")).toContain("Environment: Paprika v0.9.2");
    expect(url.searchParams.get("body")).toContain("Error: TypeError: Cannot read properties");
    await user.click(screen.getByRole("button", { name: "Technical details" }));
    await user.click(screen.getByRole("checkbox", { name: "Include in the report" }));
    url = read();
    expect(url.searchParams.get("body")).not.toContain("Error: TypeError");
    expect(url.searchParams.get("body")).toContain("Environment: Paprika v0.9.2");
  });

  it("passes the report to a link function", async () => {
    const user = userEvent.setup();
    const issueUrl = vi.fn(() => "https://github.com/a/b/issues/new");
    setup({ issueUrl });
    await user.click(screen.getByRole("button", { name: "Technical details" }));
    await user.click(screen.getByRole("checkbox", { name: "Include in the report" }));
    const report = (issueUrl.mock.calls as unknown as [{ includeDetails: boolean; details: string; error: { name: string } }][]).at(-1)?.[0];
    if (!report) throw new Error("no report");
    expect(report.includeDetails).toBe(false);
    expect(report.error.name).toBe("TypeError");
    expect(report.details).toContain("TypeError:");
  });

  it("handles errors that are not Error objects", () => {
    silenceBoundaryLogs();
    function Throws(): never {
      throw "plain string";
    }
    render(
      <CanvasError onReload={vi.fn()}>
        <Throws />
      </CanvasError>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("trims long stacks to a few frames", async () => {
    const user = userEvent.setup();
    silenceBoundaryLogs();
    function Throws(): never {
      const error = new Error("deep");
      error.stack = ["Error: deep", ...Array.from({ length: 30 }, (_, i) => `    at fn${i} (file.ts:${i}:1)`)].join("\n");
      throw error;
    }
    render(
      <CanvasError onReload={vi.fn()}>
        <Throws />
      </CanvasError>,
    );
    await user.click(screen.getByRole("button", { name: "Technical details" }));
    expect(screen.getByText(/at fn5 /)).toBeInTheDocument();
    expect(screen.queryByText(/at fn6 /)).not.toBeInTheDocument();
  });

  it("recovers when the owner remounts it with a new key", async () => {
    const user = userEvent.setup();
    silenceBoundaryLogs();
    function Host() {
      const [key, setKey] = useState(0);
      return (
        <>
          <button onClick={() => setKey(1)}>fixed</button>
          <CanvasError key={key} onReload={vi.fn()}>
            {key === 0 ? <Boom /> : <p>canvas ok</p>}
          </CanvasError>
        </>
      );
    }
    render(<Host />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "fixed" }));
    expect(screen.getByText("canvas ok")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("translates to pt-BR", async () => {
    await i18n.changeLanguage("pt-BR");
    try {
      setup({ issue: { repository: "a/b" } });
      expect(screen.getByRole("heading", { name: "O canvas parou de responder" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Recarregar" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Relatar no GitHub" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Detalhes técnicos" })).toBeInTheDocument();
      expect(new URL(screen.getByRole("link").getAttribute("href") as string).searchParams.get("title")).toBe("[canvas] O canvas parou de responder");
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("renders the screen alone and on the server", () => {
    const error = { name: "Error", message: "x" };
    const html = renderToString(<CanvasErrorScreen error={error} onReload={vi.fn()} />);
    expect(html).toContain("The canvas stopped responding");
  });

  it("keeps the report action first and reload last in the DOM so rtl mirrors them", () => {
    silenceBoundaryLogs();
    render(
      <div dir="rtl">
        <CanvasError onReload={vi.fn()} issue={{ repository: "a/b" }}>
          <Boom />
        </CanvasError>
      </div>,
    );
    const row = screen.getByRole("button", { name: "Reload" }).parentElement as HTMLElement;
    expect(row.firstElementChild?.textContent).toBe("Report on GitHub");
    expect(row.lastElementChild?.textContent).toBe("Reload");
  });
});

describe("CanvasError reset", () => {
  it("clears the error when resetKey changes and renders the children again", () => {
    silenceBoundaryLogs();
    let healthy = false;
    function Maybe() {
      if (!healthy) throw new Error("boom");
      return <p>canvas ok</p>;
    }
    const view = render(
      <CanvasError onReload={vi.fn()} resetKey={1}>
        <Maybe />
      </CanvasError>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    healthy = true;
    view.rerender(
      <CanvasError onReload={vi.fn()} resetKey={1}>
        <Maybe />
      </CanvasError>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    view.rerender(
      <CanvasError onReload={vi.fn()} resetKey={2}>
        <Maybe />
      </CanvasError>,
    );
    expect(screen.getByText("canvas ok")).toBeInTheDocument();
  });
});
