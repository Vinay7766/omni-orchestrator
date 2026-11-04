import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// @omni/core also runs in the desktop app's web view. Only these files may use Node APIs;
// everything else must stay browser-safe. (The package's tsconfig includes Node types so the
// Node files compile, which is why this is checked here rather than by the compiler.)
const NODE_ONLY = new Set(["node.ts", "memory/node-fs.ts", "memory/node-git.ts", "memory/node-watch.ts", "memory/node-trust.ts", "adapters/node-source.ts", "skills/node-source.ts"]);

const srcDir = dirname(fileURLToPath(import.meta.url));
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "generated" ? [] : sourceFiles(full);
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [full] : [];
  });
}

describe("browser safety of @omni/core", () => {
  for (const file of sourceFiles(srcDir)) {
    const rel = relative(srcDir, file).replace(/\\/g, "/");
    if (NODE_ONLY.has(rel)) continue;
    it(`${rel} uses no Node-only APIs`, () => {
      const code = readFileSync(file, "utf8");
      expect(code).not.toMatch(/from\s+["']node:/);
      expect(code).not.toMatch(/\bprocess\./);
      expect(code).not.toMatch(/\bBuffer\b/);
      expect(code).not.toMatch(/\brequire\(/);
    });
  }

  it("the main entry point does not re-export the Node file system", () => {
    expect(readFileSync(join(srcDir, "index.ts"), "utf8")).not.toMatch(/node-fs/);
  });
});
