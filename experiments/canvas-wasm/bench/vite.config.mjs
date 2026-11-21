// Plain object (no `import "vite"`): this folder is outside the pnpm workspace.
import { fileURLToPath } from "node:url";
const core = fileURLToPath(new URL("../../../packages/core/src/index.ts", import.meta.url));
export default {
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: { alias: { "@paprika/core": core } },
  server: { port: 5199, strictPort: true, hmr: false, watch: { ignored: ["**/results/**", "**/target/**", "**/src/**"] }, fs: { allow: ["../../.."] } },
};
