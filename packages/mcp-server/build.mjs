// Bundles the MCP server into one CommonJS file (dist/omni-mcp-server.cjs) that runs with Node
// alone: the installed desktop app ships it and starts it for each AI tool (retest bug 2,
// 2026-11-04: the app used to point tools at the build machine's dist/main.js).
// Same approach as packages/extension/build.mjs.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const result = await build({
  absWorkingDir: fileURLToPath(new URL(".", import.meta.url)),
  entryPoints: ["src/main.ts"],
  outfile: "dist/omni-mcp-server.cjs",
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node18",
  // import.meta.url does not exist in CommonJS: give it the bundle's own URL.
  define: { "import.meta.url": "__omniImportMetaUrl" },
  banner: { js: 'const __omniImportMetaUrl = require("node:url").pathToFileURL(__filename).href;' },
  logLevel: "warning",
});

// A warning in the bundle is a bug waiting to happen: fail the build instead of shipping it.
if (result.warnings.length > 0) {
  console.error(`MCP server bundle has ${result.warnings.length} warning(s); fix them before shipping`);
  process.exit(1);
}
