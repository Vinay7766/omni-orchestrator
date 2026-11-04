/**
 * Red-team tests, second pass (2026-11-04; docs/security/red-team-2026-11-04.md): the build
 * pipeline (T5.4) and the web view's content policy (T4.3). `it.fails` marks an open finding.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const workflows = readdirSync(join(root, ".github", "workflows")).filter((f) => f.endsWith(".yml"));
const read = (f: string) => readFileSync(join(root, ".github", "workflows", f), "utf8");

describe("red team: build pipeline (T5.4)", () => {
  it.fails("RT-16 (T5.4): every action is pinned to a full commit hash, so a moved tag cannot change a build", () => {
    const unpinned = workflows.flatMap((f) =>
      read(f)
        .split("\n")
        .filter((l) => /^\s*-?\s*uses:/.test(l) && !/@[0-9a-f]{40}(\s|$)/.test(l))
        .map((l) => `${f}: ${l.trim()}`),
    );
    expect(unpinned).toEqual([]);
  });

  it.fails("RT-16b (T5.4): every workflow states least-privilege token permissions", () => {
    expect(workflows.filter((f) => !/^permissions:/m.test(read(f)))).toEqual([]);
  });
});

describe("red team: content policy (T4.3)", () => {
  it.fails("RT-17 (T4.3): the web view loads no images from other sites (no channel for sending data out)", () => {
    const csp = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8")).app.security.csp as string;
    const img = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("img-src")) ?? "";
    expect(img.split(/\s+/)).not.toContain("https:");
  });
});
