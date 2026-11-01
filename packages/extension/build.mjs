// Bundles the extension into one CommonJS file (dist/extension.cjs) that VS Code-family editors
// load with require(). @omni/core is ESM-only and older editors' Node cannot require() ESM, so it
// is bundled in; `vscode` is provided by the editor at run time.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

await build({
  absWorkingDir: fileURLToPath(new URL(".", import.meta.url)),
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.cjs",
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node18",
  external: ["vscode"],
  sourcemap: true,
  logLevel: "warning",
});
