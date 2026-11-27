import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Menu, MenuContent, MenuItem, MenuTrigger, shortcutKeys } from "./menu";

describe("shortcutKeys", () => {
  it("gives one entry per key, as the platform spells them", () => {
    expect(shortcutKeys("mod+z")).toEqual(["Ctrl", "Z"]);
    expect(shortcutKeys("mod+shift+h")).toEqual(["Ctrl", "Shift", "H"]);
    expect(shortcutKeys("F2")).toEqual(["F2"]);
  });
});

describe("MenuItem shortcut", () => {
  it("shows each key in its own frame, hidden from the accessibility tree", async () => {
    render(
      <Menu pendingAnnouncement="">
        <MenuTrigger>open</MenuTrigger>
        <MenuContent>
          <MenuItem value="undo" shortcut="mod+z">
            Undo
          </MenuItem>
        </MenuContent>
      </Menu>,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "open" }));
    const item = await screen.findByRole("menuitem", { name: /Undo/ });
    const keys = [...item.querySelectorAll("kbd")];
    expect(keys.map((key) => key.textContent)).toEqual(["Ctrl", "Z"]);
    expect(keys[0]!.parentElement).toHaveAttribute("aria-hidden", "true");
  });
});
