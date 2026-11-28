import { defineConfig, type ProxyOptions } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const target = process.env.PAPRIKA_URL ?? "http://127.0.0.1:4777";

const sameOrigin: ProxyOptions["configure"] = (proxy) => {
  proxy.on("proxyReq", (req) => req.setHeader("origin", target));
  proxy.on("proxyReqWs", (req) => req.setHeader("origin", target));
};

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [tanstackStart({ spa: { enabled: true } }), viteReact(), tailwindcss()],
  preview: { host: "127.0.0.1" },
  server: {
    proxy: {
      "/api": { target, changeOrigin: true, configure: sameOrigin },
      "/mcp": { target, changeOrigin: true, configure: sameOrigin },
      "/fonts": { target, changeOrigin: true, configure: sameOrigin },
      "/ws": { target: target.replace(/^http/, "ws"), ws: true, changeOrigin: true, configure: sameOrigin },
    },
  },
});
