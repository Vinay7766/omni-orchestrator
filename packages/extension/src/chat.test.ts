import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore, PhaseEngine } from "@omni/core";
import { createNodeFs } from "@omni/core/node";
import { startNextPhaseInChat, type ChatHost } from "./chat.js";

// E (tester feedback 6): the next phase starts in a fresh chat inside the editor, prompt ready.

const fs = createNodeFs();
const person = { kind: "human" as const, tool: "Made-up Editor" };
const agent = { kind: "agent" as const, tool: "made-up-agent" };
let root: string;
let store: MemoryStore;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "omni-ext-chat-")).replace(/\\/g, "/");
  const created = await MemoryStore.create(fs, root, { name: "Orbit planner", flow: "build", mode: "full", actor: agent });
  if (!created.ok) throw new Error(JSON.stringify(created.issues));
  store = created.store;
  const engine = new PhaseEngine(store);
  await engine.start(agent, "idea-review");
  await store.appendEvent({ type: "memory_updated", actor: agent, payload: { files: [".agents/summary.md"] } });
  await engine.submit(agent, { phase: "idea-review", documents: ["docs/idea.md"], skillsUsed: [{ skill: "x", evidence: "y" }], understandingCheck: "docs/u.md" });
  await engine.approve(person, "idea-review");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function host(missingChat = false) {
  const calls: { command: string; arg?: unknown }[] = [];
  const shown: string[] = [];
  const copied: string[] = [];
  const h: ChatHost = {
    execute: async (command, arg) => {
      calls.push({ command, arg });
      if (missingChat) throw new Error(`command '${command}' not found`);
    },
    copy: async (text) => void copied.push(text),
    show: (m) => void shown.push(m),
  };
  return { h, calls, shown, copied };
}

describe("startNextPhaseInChat", () => {
  it("opens a new chat with the next phase's prompt in the box, not sent, and saves the prompt", async () => {
    const { h, calls, shown } = host();
    expect(await startNextPhaseInChat(store, h)).toBe("chat");
    expect(calls.map((c) => c.command)).toEqual(["workbench.action.chat.newChat", "workbench.action.chat.open"]);
    const arg = calls[1].arg as { query: string; isPartialQuery: boolean };
    expect(arg.isPartialQuery).toBe(true);
    expect(arg.query).toContain("Phase: research");
    expect(readFileSync(join(root, ".agents", "handoff", "next-session.md"), "utf8")).toBe(arg.query);
    expect(shown[0]).toMatch(/press enter/i);
  });

  it("copies the prompt and says how to paste it when the editor has no chat command it can use", async () => {
    const { h, copied, shown } = host(true);
    expect(await startNextPhaseInChat(store, h)).toBe("copied");
    expect(copied[0]).toContain("Phase: research");
    expect(shown[0]).toMatch(/copied/i);
  });

  it("says so when every phase is done, and opens nothing", async () => {
    const { h, calls, shown } = host();
    const done = await startNextPhaseInChat(store, h, { state: { ...(await store.readState()), currentPhase: null, phases: Object.fromEntries(["idea-review", "research", "prd", "architecture", "build", "review", "security-pass", "release", "handover"].map((p) => [p, { status: "approved" as const }])) } });
    expect(done).toBe("none");
    expect(calls).toEqual([]);
    expect(shown[0]).toMatch(/every phase is done/i);
  });
});
