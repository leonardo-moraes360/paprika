import { defineConfig, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const target = process.env.PAPRIKA_URL ?? "http://127.0.0.1:4777";

// O servidor só aceita Origin local da própria porta (anti DNS rebinding); no dev, o proxy reescreve.
const sameOrigin: ProxyOptions["configure"] = (proxy) => {
  proxy.on("proxyReq", (req) => req.setHeader("origin", target));
  proxy.on("proxyReqWs", (req) => req.setHeader("origin", target));
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": { target, changeOrigin: true, configure: sameOrigin },
      "/mcp": { target, changeOrigin: true, configure: sameOrigin },
      "/fonts": { target, changeOrigin: true, configure: sameOrigin },
      "/ws": { target: target.replace(/^http/, "ws"), ws: true, changeOrigin: true, configure: sameOrigin },
    },
  },
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 1000 },
});
