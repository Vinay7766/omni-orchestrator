import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    // Test against core's source so packages don't need a build first.
    alias: { "@omni/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)) },
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
