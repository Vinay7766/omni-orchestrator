import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const core = (file: string) => fileURLToPath(new URL(`../core/src/${file}`, import.meta.url));

export default defineConfig({
  resolve: {
    // Test against core's source so packages don't need a build first. Most specific first.
    alias: [
      { find: /^@omni\/core\/node$/, replacement: core("node.ts") },
      { find: /^@omni\/core$/, replacement: core("index.ts") },
    ],
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
