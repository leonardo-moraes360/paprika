import type { WasmLoader, WasmModule } from "@/components/frontends/canvas";

/** What `wasm-bindgen --target web` writes (`crates/render/build.mjs` -> `src/wasm/paprika_render.js`): the binary is fetched by `default()`, then `createRenderer` is ready. */
type Glue = WasmModule & { default: () => Promise<unknown> };

/**
 * The artifact is gitignored and exists only where Rust built it. `import.meta.glob` finds nothing without it, so a build
 * (and a test) of a checkout without it still works and the canvas paints with the DOM; with it, the module becomes its
 * own chunk and its binary an asset, fetched when WASM is first asked for.
 */
const found = import.meta.glob<Glue>("../wasm/paprika_render.js");
const open = Object.values(found)[0];

/** Whether this build carries the renderer. */
export const wasmAvailable = open !== undefined;

/**
 * The loader of the renderer module, or `null` when this build has none. Each call makes its own cache: the module is
 * instantiated once per editor and the same instance serves every toggle (not one per click).
 */
export function createWasmLoader(): WasmLoader | null {
  if (!open) return null;
  let pending: Promise<WasmModule> | null = null;
  return () => {
    if (!pending) {
      const attempt = open().then(async (mod) => {
        await mod.default();
        return mod;
      });
      pending = attempt;
      // A failure is not kept: the next try (the person picks WASM again) loads anew.
      attempt.catch(() => {
        if (pending === attempt) pending = null;
      });
    }
    return pending;
  };
}
