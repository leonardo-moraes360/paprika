import { afterEach, describe, expect, it } from "vitest";
import { parseRenderer, readRendererPreference } from "./renderer-preference";

const go = (search: string) => window.history.replaceState(null, "", `/${search}`);

afterEach(() => {
  go("");
  window.localStorage.removeItem("paprika.renderer");
});

describe("parseRenderer", () => {
  it("knows the three modes and nothing else", () => {
    expect(parseRenderer("dom", false)).toBe("dom");
    expect(parseRenderer("cpu", false)).toBe("cpu");
    expect(parseRenderer("gpu", false)).toBe("gpu");
    expect(parseRenderer("auto", true)).toBeNull();
    expect(parseRenderer(null, true)).toBeNull();
  });

  it("reads the legacy wasm as gpu where there is WebGPU, cpu where there is not, and cpu in a capture", () => {
    expect(parseRenderer("wasm", true)).toBe("gpu");
    expect(parseRenderer("wasm", false)).toBe("cpu");
    expect(parseRenderer("wasm", true, true)).toBe("cpu");
  });

  it("gpu from the URL stays gpu without WebGPU: the canvas tells the person and goes to the CPU", () => {
    expect(parseRenderer("gpu", false)).toBe("gpu");
  });

  it("a capture is cpu whatever was asked", () => {
    expect(parseRenderer("gpu", true, true)).toBe("cpu");
    expect(parseRenderer("cpu", true, true)).toBe("cpu");
  });
});

describe("readRendererPreference", () => {
  it("the URL wins over the saved choice, which wins over DOM", () => {
    expect(readRendererPreference()).toBe("dom");
    window.localStorage.setItem("paprika.renderer", "cpu");
    expect(readRendererPreference()).toBe("cpu");
    go("?renderer=gpu");
    expect(readRendererPreference()).toBe("gpu");
    go("?renderer=dom");
    expect(readRendererPreference()).toBe("dom");
  });

  it("a saved gpu without WebGPU is read as cpu, and kept as gpu where there is WebGPU", () => {
    window.localStorage.setItem("paprika.renderer", "gpu");
    expect(readRendererPreference()).toBe("cpu");
    Object.defineProperty(navigator, "gpu", { value: {}, configurable: true });
    try {
      expect(readRendererPreference()).toBe("gpu");
      go("?renderer=gpu&capture=n1");
      expect(readRendererPreference()).toBe("cpu");
    } finally {
      delete (navigator as unknown as { gpu?: unknown }).gpu;
    }
  });

  it("the server's ?renderer=wasm&capture=... is cpu", () => {
    go("?renderer=wasm&capture=n1");
    expect(readRendererPreference()).toBe("cpu");
  });

  it("a saved legacy wasm and an invalid URL value are read without throwing", () => {
    window.localStorage.setItem("paprika.renderer", "wasm");
    go("?renderer=bogus");
    expect(readRendererPreference()).toBe("cpu");
  });
});
