// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore, phaseHistory, saveTeam, type Invoke } from "@omni/core";
import { createNodeFs } from "@omni/core/node";
import { startFreshSession } from "./fresh-session";
import { DESKTOP_PERSON } from "./decisions";
import { fakeInvoke, appStoreOptions } from "./testing/fake-invoke";

// E11 / HND-7: the app sends the prompt built from memory to the Rust command and records the new
// session in the session tree (HND-8) unless the tool records it itself over MCP.

const node = createNodeFs();
const cli = { toolId: "made-up-cli", name: "Made-up CLI", capability: 2 as const, confirmedByPerson: true };
const mcpTool = { toolId: "made-up-mcp", name: "Made-up MCP tool", capability: 3 as const, confirmedByPerson: true };

let base: string;
let root: string;
let calls: { command: string; args: Record<string, unknown> }[];
let reply: unknown;
let invoke: Invoke;

beforeEach(async () => {
  base = mkdtempSync(join(tmpdir(), "omni-app-fresh-")).replace(/\\/g, "/");
  root = `${base}/orbit`;
  const created = await MemoryStore.create(node, root, { name: "Orbit", flow: "build", mode: "full", actor: DESKTOP_PERSON }, appStoreOptions());
  if (!created.ok) throw new Error(JSON.stringify(created.issues));
  const saved = await saveTeam({ store: created.store, fs: node, root }, DESKTOP_PERSON, [cli, mcpTool]);
  if (!saved.ok) throw new Error(saved.message);
  calls = [];
  const files = fakeInvoke();
  invoke = (command, args) => {
    calls.push({ command, args: args as Record<string, unknown> });
    if (command === "start_fresh_session_cmd") return reply instanceof Error ? Promise.reject(reply.message) : Promise.resolve(reply);
    return files(command, args);
  };
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const started = (toolId: string, toolName: string, promptPassed: boolean) => ({ toolId, toolName, launched: true, promptPassed, message: `${toolName} was started.` });

const sessions = async () => {
  const opened = await MemoryStore.open(node, root, appStoreOptions());
  if (!opened.ok) throw new Error("reopen");
  return (await phaseHistory(opened.store)).flatMap((h) => h.sessions.map((s) => ({ phase: h.phase, tool: s.by.tool })));
};

describe("startFreshSession", () => {
  it("sends the prompt built from memory, naming the project and the phase", async () => {
    reply = started("made-up-cli", "Made-up CLI", true);
    const outcome = await startFreshSession(invoke, root, "made-up-cli");
    expect(outcome.ok).toBe(true);
    const call = calls.find((c) => c.command === "start_fresh_session_cmd")!;
    const request = call.args.request as { projectPath: string; toolId: string; prompt: string };
    expect(request.projectPath).toBe(root);
    expect(request.toolId).toBe("made-up-cli");
    expect(request.prompt).toContain("Orbit");
    expect(request.prompt).toContain("Phase: idea-review");
    expect(outcome.ok && outcome.prompt).toBe(request.prompt);
  });

  it("records the new session of a tool without MCP in the session tree, named by the tool", async () => {
    reply = started("made-up-cli", "Made-up CLI", true);
    const outcome = await startFreshSession(invoke, root, "made-up-cli");
    expect(outcome.ok && outcome.sessionRecorded).toBe(true);
    expect(await sessions()).toEqual([{ phase: "idea-review", tool: "Made-up CLI" }]);
  });

  it("leaves recording to the MCP server for a tool connected over MCP (no double entry)", async () => {
    reply = started("made-up-mcp", "Made-up MCP tool", false);
    const outcome = await startFreshSession(invoke, root, "made-up-mcp");
    expect(outcome.ok && outcome.sessionRecorded).toBe(false);
    expect(await sessions()).toEqual([]);
  });

  it("records nothing when the tool could not be started", async () => {
    reply = { ...started("made-up-cli", "Made-up CLI", false), launched: false };
    await startFreshSession(invoke, root, "made-up-cli");
    expect(await sessions()).toEqual([]);
  });

  it("refuses a tool not selected for the project without calling the command", async () => {
    const outcome = await startFreshSession(invoke, root, "someone-else");
    expect(outcome.ok).toBe(false);
    expect(calls.some((c) => c.command === "start_fresh_session_cmd")).toBe(false);
  });

  it("reports the command's own error", async () => {
    reply = new Error("\"made-up-cli\" was not found on this computer any more.");
    const outcome = await startFreshSession(invoke, root, "made-up-cli");
    expect(outcome).toEqual({ ok: false, error: "\"made-up-cli\" was not found on this computer any more." });
  });
});
