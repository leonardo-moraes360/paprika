import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { FontPicker, groupFonts, type FontPickerProps } from "./index";

function setup(props: Partial<FontPickerProps> = {}) {
  const onValueChange = vi.fn();
  const view = render(<FontPicker value="Inter, system-ui, sans-serif" onValueChange={onValueChange} documentFonts={["Instrument Sans"]} queryLocalFonts={null} {...props} />);
  return { onValueChange, ...view };
}

const input = () => screen.getByRole("combobox", { name: "Font" });

async function openList(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Show fonts" }));
  return screen.findByRole("listbox");
}

describe("groupFonts", () => {
  it("dedupes across groups and keeps the current value visible", () => {
    const groups = groupFonts({ value: "Custom Sans", documentFonts: ["serif", "Doc"], commonFonts: ["serif", "monospace"], systemFonts: ["Doc", "Zeta", "serif"] });
    expect(groups.common).toEqual(["monospace", "serif"]);
    expect(groups.document).toEqual(["Custom Sans", "Doc"]);
    expect(groups.system).toEqual(["Zeta"]);
  });
});

describe("FontPicker", () => {
  it("shows the current family and lists document and common groups", async () => {
    const user = userEvent.setup();
    setup();
    expect(input()).toHaveValue("Inter");
    const list = await openList(user);
    expect(screen.getByText("In the document")).toBeInTheDocument();
    expect(screen.getByText("Common")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Instrument Sans" })).toBeInTheDocument();
    expect(list).toBeInTheDocument();
  });

  it("emits the full family stack when an option is chosen", async () => {
    const user = userEvent.setup();
    const { onValueChange } = setup();
    await openList(user);
    await user.click(screen.getByRole("option", { name: "Georgia" }));
    expect(onValueChange).toHaveBeenCalledWith("Georgia, serif");
  });

  it("creates the typed family on Enter when nothing matches", async () => {
    const user = userEvent.setup();
    const { onValueChange } = setup();
    await user.click(input());
    await user.keyboard("{Control>}a{/Control}Space Grotesk{Enter}");
    expect(onValueChange).toHaveBeenCalledWith("Space Grotesk");
    expect(onValueChange).toHaveBeenCalledTimes(1);
  });

  it("filters while typing", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(input());
    await user.keyboard("{Control>}a{/Control}mono");
    expect(await screen.findByRole("option", { name: "monospace" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Georgia" })).not.toBeInTheDocument();
  });

  it("is controlled: follows value changes from the owner", async () => {
    const user = userEvent.setup();
    function Owner() {
      const [value, setValue] = useState("serif");
      return (
        <>
          <button onClick={() => setValue("monospace")}>swap</button>
          <FontPicker value={value} onValueChange={setValue} queryLocalFonts={null} />
        </>
      );
    }
    render(<Owner />);
    expect(input()).toHaveValue("serif");
    await user.click(screen.getByRole("button", { name: "swap" }));
    expect(input()).toHaveValue("monospace");
  });

  it("loads system fonts with the permission API: loading then a System group", async () => {
    const user = userEvent.setup();
    let resolve!: (value: { family: string }[]) => void;
    const queryLocalFonts = vi.fn(() => new Promise<{ family: string }[]>((r) => (resolve = r)));
    setup({ queryLocalFonts });
    await openList(user);
    await user.click(screen.getByRole("button", { name: "Use system fonts…" }));
    expect(screen.getByText("Reading system fonts…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use system fonts…" })).toBeDisabled();
    await act(async () => resolve([{ family: "Zapfino" }, { family: "Georgia" }]));
    expect(await screen.findByRole("option", { name: "Zapfino" })).toBeInTheDocument();
    expect(screen.getByText("System")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh system fonts" })).toBeInTheDocument();
  });

  it("shows an error when the permission is refused", async () => {
    const user = userEvent.setup();
    setup({ queryLocalFonts: vi.fn().mockRejectedValue(new Error("denied")) });
    await openList(user);
    await user.click(screen.getByRole("button", { name: "Use system fonts…" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not read the system fonts.");
  });

  it("says so when the browser has no local fonts API", async () => {
    const user = userEvent.setup();
    setup({ queryLocalFonts: null });
    await openList(user);
    await user.click(screen.getByRole("button", { name: "Use system fonts…" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This browser does not expose local fonts.");
  });

  it("falls back to the window API when no prop is given, and tolerates its absence", async () => {
    const user = userEvent.setup();
    const query = vi.fn().mockResolvedValue([{ family: "Window Font" }]);
    vi.stubGlobal("queryLocalFonts", query);
    window.queryLocalFonts = query;
    setup({ queryLocalFonts: undefined });
    await openList(user);
    await user.click(screen.getByRole("button", { name: "Use system fonts…" }));
    await waitFor(() => expect(query).toHaveBeenCalledOnce());
    expect(await screen.findByRole("option", { name: "Window Font" })).toBeInTheDocument();
    delete (window as { queryLocalFonts?: unknown }).queryLocalFonts;
    vi.unstubAllGlobals();
  });

  it("renders in Portuguese", async () => {
    await i18n.changeLanguage("pt-BR");
    try {
      const user = userEvent.setup();
      setup();
      await user.click(screen.getByRole("button", { name: "Mostrar fontes" }));
      expect(await screen.findByText("No documento")).toBeInTheDocument();
      expect(screen.getByText("Comuns")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Usar fontes do sistema…" })).toBeInTheDocument();
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("renders on the server without touching the browser", () => {
    const html = renderToString(<FontPicker value="serif" onValueChange={() => {}} />);
    expect(html).toContain("Font");
  });
});

declare global {
  interface Window {
    queryLocalFonts?: unknown;
  }
}
