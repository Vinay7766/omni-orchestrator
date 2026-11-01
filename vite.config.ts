import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import process from "node:process";
import { fileURLToPath } from "node:url";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    // The app runs @omni/core from source (it is built after the app in `npm run build`).
    // @omni/core/node is for tests only: the web view itself has no Node APIs.
    alias: [
      { find: /^@omni\/core\/node$/, replacement: fileURLToPath(new URL("./packages/core/src/node.ts", import.meta.url)) },
      { find: /^@omni\/core$/, replacement: fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)) },
    ],
  },
  test: {
    environment: "jsdom",
    globals: true,
    pool: "threads",
    // Desktop app tests only; each workspace package runs its own tests.
    include: ["src/**/*.test.{ts,tsx}"],
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
