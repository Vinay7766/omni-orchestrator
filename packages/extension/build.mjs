// Bundles the extension into one CommonJS file (dist/extension.cjs) that VS Code-family editors
// load with require(). @omni/core is ESM-only and older editors' Node cannot require() ESM, so it
// is bundled in; `vscode` is provided by the editor at run time.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const result = await build({
  absWorkingDir: fileURLToPath(new URL(".", import.meta.url)),
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.cjs",
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node18",
  external: ["vscode"],
  // import.meta.url does not exist in CommonJS; core's Node helpers use it. Give it the bundle's
  // own URL instead of leaving it empty (a silent wrong path if such a helper were ever called).
  define: { "import.meta.url": "__omniImportMetaUrl" },
  banner: { js: 'const __omniImportMetaUrl = require("node:url").pathToFileURL(__filename).href;' },
  sourcemap: true,
  logLevel: "warning",
});

// A warning in the bundle is a bug waiting to happen (for example import.meta being empty in
// CommonJS): fail the build instead of shipping it.
if (result.warnings.length > 0) {
  console.error(`extension bundle has ${result.warnings.length} warning(s); fix them before shipping`);
  process.exit(1);
}
