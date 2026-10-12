import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiPort = Number(process.env.PORT) || 8787;

// The browser only ever talks to /api on the same origin. In development Vite
// proxies it to the Express server; in production Express serves the build.
// No env variable is exposed to the client bundle (envPrefix is never matched).
export default defineConfig({
  root: "client",
  envPrefix: "JULIA_PUBLIC_",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: `http://localhost:${apiPort}`, changeOrigin: false },
    },
  },
  preview: { port: 4173 },
  // The Retell SDK chunk (WebRTC stack) is large but lazy-loaded on first call.
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 900 },
});
