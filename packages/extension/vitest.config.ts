import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    // Test against core's source so packages don't need a build first.
    alias: [
      { find: /^@omni\/core\/node$/, replacement: fileURLToPath(new URL("../core/src/node.ts", import.meta.url)) },
      { find: /^@omni\/core$/, replacement: fileURLToPath(new URL("../core/src/index.ts", import.meta.url)) },
    ],
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
