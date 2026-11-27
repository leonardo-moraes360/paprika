import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Popover } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { registerShellPropertiesScript, SHELL_PROPERTIES } from "./-shell-properties";

describe("custom properties registered from the head", () => {
  it("are exactly the ones the UI SDK registers for the scroll area and the positioner (a bump of the library that adds one fails here)", async () => {
    const registered: string[] = [];
    vi.stubGlobal("CSS", { registerProperty: (definition: { name: string }) => void registered.push(definition.name), supports: () => true, escape: (s: string) => s });
    const user = userEvent.setup();
    render(
      <>
        <ScrollArea className="h-10">
          <p>content</p>
        </ScrollArea>
        <Popover trigger={<button type="button">open</button>} title="t">
          body
        </Popover>
      </>,
    );
    await user.click(screen.getByRole("button", { name: "open" }));
    await screen.findByText("body");
    vi.unstubAllGlobals();
    expect([...new Set(registered)].sort()).toEqual([...SHELL_PROPERTIES].sort());
  });

  it("the head script registers each one as the library does (any syntax, not inherited) and survives a repeat", () => {
    const calls: { name: string; syntax: string; inherits: boolean }[] = [];
    const seen = new Set<string>();
    vi.stubGlobal("CSS", {
      registerProperty: (definition: { name: string; syntax: string; inherits: boolean }) => {
        if (seen.has(definition.name)) throw new Error("already registered");
        seen.add(definition.name);
        calls.push(definition);
      },
    });
    new Function(registerShellPropertiesScript)();
    new Function(registerShellPropertiesScript)();
    vi.unstubAllGlobals();
    expect(calls.map((call) => call.name)).toEqual([...SHELL_PROPERTIES]);
    expect(calls.every((call) => call.syntax === "*" && call.inherits === false)).toBe(true);
  });
});
