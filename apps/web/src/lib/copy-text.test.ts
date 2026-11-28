import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./copy-text";

const setClipboard = (value: unknown) => Object.defineProperty(navigator, "clipboard", { value, configurable: true });
const setExec = (value: unknown) => Object.defineProperty(document, "execCommand", { value, configurable: true });

describe("copyText", () => {
  const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  afterEach(() => {
    if (original) Object.defineProperty(navigator, "clipboard", original);
    else Reflect.deleteProperty(navigator, "clipboard");
    Reflect.deleteProperty(document, "execCommand");
    document.body.innerHTML = "";
  });

  it("writes through the async clipboard when it exists", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard({ writeText });
    expect(await copyText("hello")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("falls back to a temporary textarea and execCommand without navigator.clipboard", async () => {
    setClipboard(undefined);
    const exec = vi.fn(() => {
      expect(document.activeElement).toBeInstanceOf(HTMLTextAreaElement);
      expect((document.activeElement as HTMLTextAreaElement).value).toBe("hello");
      return true;
    });
    setExec(exec);
    expect(await copyText("hello")).toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("falls back when the async clipboard rejects", async () => {
    setClipboard({ writeText: vi.fn(() => Promise.reject(new Error("denied"))) });
    const exec = vi.fn(() => true);
    setExec(exec);
    expect(await copyText("x")).toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
  });

  it("uses the given field as the fallback target and leaves it in the page", async () => {
    setClipboard(undefined);
    const field = document.createElement("input");
    field.value = "link";
    document.body.append(field);
    const select = vi.spyOn(field, "select");
    setExec(vi.fn(() => true));
    expect(await copyText("link", field)).toBe(true);
    expect(select).toHaveBeenCalled();
    expect(field.isConnected).toBe(true);
  });

  it("reports false when the fallback fails or throws", async () => {
    setClipboard(undefined);
    setExec(vi.fn(() => false));
    expect(await copyText("x")).toBe(false);
    setExec(
      vi.fn(() => {
        throw new Error("no");
      }),
    );
    expect(await copyText("x")).toBe(false);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("reports false when execCommand does not exist", async () => {
    setClipboard(undefined);
    setExec(undefined);
    expect(await copyText("x")).toBe(false);
  });
});
