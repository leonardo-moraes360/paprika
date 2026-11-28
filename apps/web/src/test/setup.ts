import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import i18n from "@/i18n";
import { fakeWasm } from "./fake-wasm";

// The renderer artifact is built only where Rust is installed: no test may depend on it. The stand-in answers like the real module.
vi.mock("@/editor/wasm-module", () => ({
  get wasmAvailable() {
    return fakeWasm.available;
  },
  createWasmLoader: () => (fakeWasm.available ? fakeWasm.loader : null),
}));

declare global {
  var __UI_SDK_STRICT__: boolean | undefined;
}
globalThis.__UI_SDK_STRICT__ = true;
configure({ reactStrictMode: true });

HTMLElement.prototype.showPopover = function () {};
HTMLElement.prototype.hidePopover = function () {};
Element.prototype.getAnimations = () => [];
Element.prototype.scrollIntoView = function () {};
Element.prototype.checkVisibility = () => true;
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
document.head.append(Object.assign(document.createElement("style"), { textContent: "[popover] { display: block !important }" }));

await i18n.changeLanguage("en");

afterEach(() => {
  cleanup();
  fakeWasm.reset();
  window.localStorage.clear();
});
