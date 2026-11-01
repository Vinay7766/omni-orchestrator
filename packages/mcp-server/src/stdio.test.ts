/**
 * End to end: the built server, started as an AI tool would start it (a child process speaking
 * MCP over stdio, working directory inside the project), with the repository's real skill catalog.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MemoryStore } from "@omni/core";
import { createNodeFs } from "@omni/core/node";

const pkgDir = fileURLToPath(new URL("..", import.meta.url));
const agent = { kind: "agent" as const, tool: "made-up-agent" };
let root: string;

beforeAll(async () => {
  // Build first, so this never runs against an old build (incremental; also builds core).
  const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
  execFileSync(process.execPath, [tsc, "-b", pkgDir], { stdio: "pipe" });

  root = mkdtempSync(join(tmpdir(), "omni-mcp-stdio-")).replace(/\\/g, "/");
  const created = await MemoryStore.create(createNodeFs(), root, { name: "Orbit planner", flow: "build", mode: "full", actor: agent });
  if (!created.ok) throw new Error(JSON.stringify(created.issues));
  const started = await created.store.appendEvent({ type: "phase_started", actor: agent, payload: { phase: "build" } });
  if (!started.ok) throw new Error(JSON.stringify(started));
  mkdirSync(join(root, "src"));
}, 120_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("stdio server", () => {
  it("answers get_context for the project it was started in", async () => {
    const client = new Client({ name: "made-up-client", version: "0.0.1" });
    await client.connect(
      new StdioClientTransport({ command: process.execPath, args: [join(pkgDir, "dist", "main.js")], cwd: `${root}/src`, stderr: "pipe" }),
    );
    try {
      const result = await client.callTool({ name: "get_context", arguments: {} });
      expect(result.isError).toBeFalsy();
      const ctx = result.structuredContent as { project: { root: string }; phase: { id: string }; skills: { reason: string }[]; warnings: string[] };
      expect(ctx.project.root).toBe(root);
      expect(ctx.phase.id).toBe("build");
      // The real catalog maps skills to the build phase (A4 guarantees every phase has some).
      expect(ctx.skills.some((s) => s.reason === "phase")).toBe(true);
      expect(ctx.warnings.filter((w) => /catalog/i.test(w))).toEqual([]);
    } finally {
      await client.close();
    }
  }, 60_000);
});
