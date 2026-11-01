import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MemoryStore, type CatalogEntry, type SkillSource } from "@omni/core";
import { createNodeFs } from "@omni/core/node";
import { createServer } from "./server.js";

const fs = createNodeFs();
const agent = { kind: "agent" as const, tool: "made-up-agent" };

const skills: SkillSource = {
  list: async () => ({
    ok: true,
    entries: [
      {
        id: "build-well",
        name: "Build well",
        description: "A made-up build skill.",
        category: "engineering",
        attribution: { name: "Someone", sourceUrl: "https://example.com", verified: true },
        enabled: true,
        isCustom: false,
        license: "MIT",
        phases: ["build"],
        domains: ["testing"],
      } satisfies CatalogEntry,
    ],
  }),
  readContent: async (id) => (id === "build-well" ? "# Build well\nDo it well.\n" : null),
};

let root: string;
let client: Client;

async function connect(startDir: string) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer({ fs, skills, startDir }).connect(serverSide);
  client = new Client({ name: "made-up-client", version: "0.0.1" });
  await client.connect(clientSide);
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "omni-mcp-srv-")).replace(/\\/g, "/");
  const created = await MemoryStore.create(fs, root, { name: "Orbit planner", flow: "build", mode: "full", actor: agent });
  if (!created.ok) throw new Error(JSON.stringify(created.issues));
  const store = created.store;
  for (const [type, payload] of [
    ["phase_started", { phase: "build" }],
    ["task_created", { taskId: "T-1", title: "Parser" }],
    ["task_marked_trivial", { taskId: "T-1", reason: "Small" }],
    ["task_started", { taskId: "T-1" }],
  ] as const) {
    const r = await store.appendEvent({ type, actor: agent, payload });
    if (!r.ok) throw new Error(JSON.stringify(r));
  }
});
afterEach(async () => {
  await client?.close();
  rmSync(root, { recursive: true, force: true });
});

describe("MCP server", () => {
  it("offers its tools, with no way for an agent to approve or request changes (GATE-2)", async () => {
    await connect(root);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(["get_context", "get_phase_skills", "submit_phase"]);
    expect(names.filter((n) => /approve|request_changes|review/i.test(n))).toEqual([]);
    for (const name of ["get_context", "get_phase_skills"]) {
      const tool = tools.find((t) => t.name === name)!;
      expect(tool.annotations, name).toMatchObject({ readOnlyHint: true });
      expect(tool.outputSchema, name).toBeDefined();
    }
  });

  it("serves the full text of the phase's skills", async () => {
    await connect(root);
    const result = await client.callTool({ name: "get_phase_skills", arguments: {} });
    expect(result.isError).toBeFalsy();
    const value = result.structuredContent as { phase: string; skills: { id: string; content: string }[] };
    expect(value.phase).toBe("build");
    expect(value.skills).toEqual([expect.objectContaining({ id: "build-well", content: "# Build well\nDo it well.\n" })]);
  });

  it("submits a phase as the connected agent, never as a person", async () => {
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "docs", "build-notes.md"), "notes\n");
    await connect(root);
    const result = await client.callTool({
      name: "submit_phase",
      arguments: {
        phase: "build",
        documents: ["docs/build-notes.md"],
        skillsUsed: [{ skill: "build-well", evidence: "Red test first, see docs/build-notes.md" }],
        memoryUpdate: { files: ["docs/build-notes.md"] },
        model: "made-up-model",
      },
    });
    expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ phase: "build", status: "awaiting_review" });
    const opened = await MemoryStore.open(fs, root);
    if (!opened.ok) throw new Error("reopen");
    const last = (await opened.store.readEvents()).events.at(-1)!;
    expect(last.type).toBe("phase_submitted");
    expect(last.actor).toEqual({ kind: "agent", tool: "made-up-client", model: "made-up-model" });
  });

  it("rejects a submission without a skills-used list", async () => {
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "docs", "build-notes.md"), "notes\n");
    await connect(root);
    for (const skillsUsed of [undefined, []]) {
      const result = await client.callTool({
        name: "submit_phase",
        arguments: { phase: "build", documents: ["docs/build-notes.md"], memoryUpdate: { files: ["docs/build-notes.md"] }, ...(skillsUsed ? { skillsUsed } : {}) },
      });
      expect(result.isError, JSON.stringify(skillsUsed)).toBe(true);
    }
  });

  it("returns a tool error for a skill outside the phase", async () => {
    await connect(root);
    const result = await client.callTool({ name: "get_phase_skills", arguments: { ids: ["not-in-phase"] } });
    expect(result.isError).toBe(true);
  });

  it("gives a client the summary, phase, task and skills in one call", async () => {
    await connect(root);
    const result = await client.callTool({ name: "get_context", arguments: {} });
    expect(result.isError).toBeFalsy();
    const ctx = result.structuredContent as Record<string, any>;
    expect(ctx.summary).toMatch(/^# Orbit planner/);
    expect(ctx.phase).toEqual({ id: "build", status: "in_progress" });
    expect(ctx.tasks.inProgress.map((t: { id: string }) => t.id)).toEqual(["T-1"]);
    expect(ctx.skills.map((s: { id: string }) => s.id)).toEqual(["build-well"]);
    // Clients that ignore structured output get the same data as text.
    const text = (result.content as { type: string; text: string }[])[0];
    expect(JSON.parse(text.text)).toEqual(ctx);
  });

  it("accepts a projectPath when the server started elsewhere", async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), "omni-mcp-else-")).replace(/\\/g, "/");
    try {
      await connect(elsewhere);
      const result = await client.callTool({ name: "get_context", arguments: { projectPath: root } });
      expect((result.structuredContent as { project: { root: string } }).project.root).toBe(root);
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it("returns an actionable error, not a crash, when there is no project", async () => {
    const empty = mkdtempSync(join(tmpdir(), "omni-mcp-empty-")).replace(/\\/g, "/");
    try {
      await connect(empty);
      const result = await client.callTool({ name: "get_context", arguments: {} });
      expect(result.isError).toBe(true);
      const message = (result.content as { text: string }[])[0].text;
      expect(message).toMatch(/projectPath/);
      expect(message).not.toMatch(/\n\s+at /); // no stack trace
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("rejects a projectPath that is not a non-empty string", async () => {
    await connect(root);
    for (const projectPath of [42, ""]) {
      const result = await client.callTool({ name: "get_context", arguments: { projectPath } });
      expect(result.isError, `projectPath ${JSON.stringify(projectPath)}`).toBe(true);
    }
  });
});
