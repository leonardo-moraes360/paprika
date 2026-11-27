import { describe, expect, it, vi } from "vitest";
import { coverBody, maxCoverBytes, type CoverDeps } from "./cover-image";

const file = (type: string, size: number) => new File([new Uint8Array(size)], "x", { type });

function deps(width: number, blob: Blob | null = new Blob(["w"], { type: "image/webp" })) {
  const canvas = { width: 0, height: 0, toBlob: vi.fn((done: (b: Blob | null) => void) => done(blob)) } as unknown as HTMLCanvasElement;
  const close = vi.fn();
  const draw = vi.fn();
  const value: CoverDeps = { decode: vi.fn(async () => ({ width, height: width / 2, draw, close })), makeCanvas: () => canvas };
  return { value, canvas, close, draw };
}

describe("cover image", () => {
  it("sends a supported image of at most 2 MiB untouched", async () => {
    const small = file("image/png", 1000);
    const d = deps(100);
    expect(await coverBody(small, "fail", d.value)).toBe(small);
    expect(d.value.decode).not.toHaveBeenCalled();
    const edge = file("image/jpeg", maxCoverBytes);
    expect(await coverBody(edge, "fail", d.value)).toBe(edge);
  });

  it("reduces a big image to 960 px wide webp and releases the bitmap", async () => {
    const d = deps(3840);
    const out = await coverBody(file("image/png", maxCoverBytes + 1), "fail", d.value);
    expect(out.type).toBe("image/webp");
    expect(d.canvas.width).toBe(960);
    expect(d.canvas.height).toBe(480);
    expect(d.draw).toHaveBeenCalledOnce();
    expect(d.close).toHaveBeenCalledOnce();
    expect(d.canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/webp", 0.85);
  });

  it("converts an unsupported type without enlarging a narrow image", async () => {
    const d = deps(300);
    await coverBody(file("image/bmp", 10), "fail", d.value);
    expect(d.canvas.width).toBe(300);
  });

  it("rejects with the given message when the image cannot be decoded or encoded", async () => {
    const broken: CoverDeps = { decode: () => Promise.reject(new Error("bad")), makeCanvas: () => document.createElement("canvas") };
    await expect(coverBody(file("image/bmp", 10), "could not convert", broken)).rejects.toThrow("could not convert");
    await expect(coverBody(file("image/bmp", 10), "no blob", deps(100, null).value)).rejects.toThrow("no blob");
  });
});
