// @vitest-environment node
/**
 * F1: the whole v0.1 way for one project, through each channel's real code and one shared memory.
 *
 * App (desktop): the app's own functions over `fakeInvoke` (memfs commands on real files).
 * Agent (MCP): an MCP client connected to the real server over the SDK's in-memory transport.
 * Person in the editor (extension): the extension's `approvePhase` with a scripted person.
 *
 * Stand-ins, because they cannot run in CI: the model (`byok_complete` returns scripted answers) and
 * the Rust `hand_off_tool` command (writes AGENTS.md and opens the tool; tested in Rust). Real tools
 * are checked by hand in F2.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MemoryStore, type CatalogEntry, type Invoke, type SkillSource } from "@omni/core";
import { createNodeFs } from "@omni/core/node";
import { closeServer, createServer, sessionRecorded } from "../../packages/mcp-server/src/server";
import { approvePhase, type GateUi } from "../../packages/extension/src/gate";
import { createProjectFromIdea } from "../lib/planning";
import { runPhase } from "../lib/phase-runner";
import { approve, DESKTOP_PERSON } from "../lib/decisions";
import { approveTaskList, proposeTasks } from "../lib/task-proposal";
import { handOffTool, saveTeamSelection } from "../lib/team";
import { loadProjectDetail } from "../lib/projects";
import { fakeInvoke } from "../lib/testing/fake-invoke";
import type { Skill } from "../lib/types";

const node = createNodeFs();
const MODEL = "made-up-model";
const EDITOR_PERSON = { kind: "human" as const, tool: "Made-up Editor" };
const byok = { ollamaEndpoint: "http://localhost:11434", preferredModel: MODEL };

// --- The app's skill catalog (planning) and the MCP server's (build): made-up skills only.
function appSkill(id: string, phases: string[]): Skill {
  return {
    id,
    name: `${id} name`,
    description: `${id} description`,
    category: "strategy",
    attribution: { name: "Made-up Author", sourceUrl: "https://example.org", verified: true },
    enabled: true,
    content: `${id} skill body`,
    isCustom: false,
    phases,
    license: "MIT",
  };
}
const APP_SKILLS = [
  appSkill("made-up-idea-review", ["idea-review"]),
  appSkill("made-up-research", ["research"]),
  appSkill("made-up-prd", ["prd"]),
  appSkill("made-up-stack", ["architecture"]),
];

const buildSkill: CatalogEntry = {
  id: "made-up-tdd",
  name: "Made-up TDD",
  description: "Failing test first.",
  category: "engineering",
  attribution: { name: "Made-up Author", sourceUrl: "https://example.org", verified: true },
  enabled: true,
  isCustom: false,
  license: "MIT",
  phases: ["build"],
  domains: ["testing"],
};
const serverSkills: SkillSource = {
  list: async () => ({ ok: true, entries: [buildSkill] }),
  readContent: async (id) => (id === buildSkill.id ? "# Made-up TDD\nWrite the failing test first.\n" : null),
};

// --- The model's scripted answers, one per request, in the order the app asks.
const phaseAnswer = (doc: string, skill: string, evidence: string) =>
  `${doc}\n\n## Understanding check\n\nThe person wants a shared shopping list for families.\n\n## Skills applied\n\n- ${skill}: ${evidence}\n`;
const ADR = [
  "# Stack decision record",
  "## Status\n\nProposed",
  "## Context and constraints\n\nOne developer, web first.",
  "## Options considered\n\nA small web app; a native app.",
  "## Decision\n\nA small web app is the best fit for these constraints.",
  "## Why the others lost\n\nA native app needs two code bases.",
  "## Switch conditions\n\nMove to native past 10k daily users.",
  "## Sources\n\nhttps://example.org/docs",
].join("\n\n");
const MODEL_ANSWERS = [
  phaseAnswer("# Idea review\n\nVerdict: worth building.", "made-up-idea-review", "weighed problem, users and alternatives"),
  phaseAnswer("# Research\n\nThree paper-list habits found.", "made-up-research", "listed three competitors with links"),
  phaseAnswer("# PRD\n\nREQ-1: add an item to the shared list.", "made-up-prd", "requirements with ids"),
  phaseAnswer(`# Architecture\n\nOne web client, one list store.\n\n${ADR}`, "made-up-stack", "compared two stacks against the constraints"),
  'The list, in order.\n\n```json\n{"tasks": [{"title": "Shared list data model", "requirements": ["REQ-1"], "kinds": ["backend", "tests"]}]}\n```\n',
];

let base: string;
let root: string;
let modelPrompts: string[];
let handoffRequests: unknown[];
let client: Client;
let server: McpServer | undefined;

const invoke: Invoke = (command, args) => {
  if (command === "byok_complete") {
    modelPrompts.push((args.request as { prompt: string }).prompt);
    const text = MODEL_ANSWERS[modelPrompts.length - 1];
    return text ? Promise.resolve({ text, provider: "ollama", model: MODEL }) : Promise.reject("No more scripted answers");
  }
  if (command === "hand_off_tool") {
    handoffRequests.push(args.request);
    return Promise.resolve({ toolId: "made-up-editor", level: 3, files: ["AGENTS.md created."], mcp: null, mcpProblem: null, launched: true, message: "Made-up Editor was opened." });
  }
  return fakeInvoke()(command, args);
};

/** Calls an MCP tool as the agent would; fails the test with the server's message on an error. */
async function call(name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: { projectPath: root, ...args } });
  if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.content)}`);
  return result.structuredContent as Record<string, unknown>;
}

const openStore = async () => {
  const opened = await MemoryStore.open(node, root);
  if (!opened.ok) throw new Error(JSON.stringify(opened.issues));
  return opened.store;
};

/** The handed-off tool starts the MCP server inside the project folder, as a real tool would. */
async function connectAgent() {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  server = createServer({ fs: node, skills: serverSkills, startDir: root });
  await server.connect(serverSide);
  client = new Client({ name: "made-up-agent", version: "0.0.1" });
  await client.connect(clientSide);
  // The session record is written in the background after connecting (E10); wait for a settled log.
  await sessionRecorded(server);
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "omni-e2e-")).replace(/\\/g, "/");
  modelPrompts = [];
  handoffRequests = [];
  server = undefined;
});
afterEach(async () => {
  // closeServer waits for the session's end record, so nothing is still writing when the folder goes.
  if (server) await closeServer(server);
  rmSync(base, { recursive: true, force: true });
});

describe("v0.1 end to end (F1)", () => {
  it("takes one idea from the app to an approved build, across app, MCP server and extension", async () => {
    // 1. App: the person types an idea; a project is created.
    const created = await createProjectFromIdea(invoke, { parent: base, name: "Orbit", idea: "A shared shopping list" });
    if (!created.ok) throw new Error(created.error);
    root = created.root;

    // 2. App: each planning phase runs with the person's model and is approved by the person.
    for (const phase of ["idea-review", "research", "prd", "architecture"]) {
      const ran = await runPhase(invoke, root, { byok, skills: APP_SKILLS });
      expect(ran).toMatchObject({ ok: true, phase });
      const approved = await approve(invoke, root, phase);
      expect(approved).toMatchObject({ ok: true });
    }
    expect(readFileSync(`${root}/docs/planning/architecture-stack-adr.md`, "utf8")).toContain("best fit for these constraints");

    // 3. App: the model proposes the task list; the person approves it.
    expect(await proposeTasks(invoke, root, { byok, skills: APP_SKILLS })).toMatchObject({ ok: true, tasks: [{ taskId: "T-1" }] });
    expect(await approveTaskList(invoke, root)).toMatchObject({ ok: true });
    expect(modelPrompts).toHaveLength(MODEL_ANSWERS.length);

    // 4. App: the person selects a tool and hands the build to it.
    const tool = { toolId: "made-up-editor", name: "Made-up Editor", capability: 3 as const, confirmedByPerson: false };
    expect(await saveTeamSelection(invoke, root, [tool])).toMatchObject({ ok: true });
    const handed = await handOffTool(invoke, root, tool.toolId);
    expect(handed).toMatchObject({ ok: true, result: { launched: true } });
    expect((handoffRequests[0] as { agentsBlock: string }).agentsBlock).toContain("T-1: Shared list data model");

    // 5. MCP: the tool's agent reads the project from memory alone and finds the build and its task.
    await connectAgent();
    const context = await call("get_context", {});
    expect(context).toMatchObject({ phase: { id: "build", status: "in_progress" }, tasks: { next: { id: "T-1", title: "Shared list data model" } } });

    // 6. MCP: design note, start (skills acknowledged), code, complete with evidence, submit the build.
    await call("submit_design_note", {
      note: {
        formatVersion: 1,
        taskId: "T-1",
        problem: "Store items of a shared list",
        constraints: ["lists up to 500 items"],
        approaches: [
          { name: "array", idea: "items in an array", complexity: "O(n) lookup", risks: "slow past 10k items" },
          { name: "map", idea: "items keyed by id", complexity: "O(1) lookup", risks: "order kept separately" },
        ],
        chosen: "array",
        reason: "lists stay small",
        switchIf: "lists pass 10k items",
        edgeCases: ["empty list"],
        generalisationCheck: "no named examples",
        assumptions: [],
      },
    });
    const first = await call("start_task", { taskId: "T-1" });
    expect(first).toMatchObject({ started: false, declaredSkills: [{ id: "made-up-tdd" }] });
    expect(await call("start_task", { taskId: "T-1", acknowledgedSkills: ["made-up-tdd"] })).toMatchObject({ started: true });

    mkdirSync(`${root}/src`, { recursive: true });
    writeFileSync(`${root}/src/list.ts`, "export const items: string[] = [];\n");
    writeFileSync(`${root}/docs/build-notes.md`, "# Build notes\n\nT-1 done.\n");
    expect(
      await call("complete_task", {
        taskId: "T-1",
        summary: "Shared list data model",
        skillsUsed: [{ skill: "made-up-tdd", evidence: "list test failed, then passed" }],
        tests: { command: "npm test", exitCode: 0, outputTail: "1 passed" },
        refs: { files: ["src/list.ts"] },
        memoryUpdate: { files: ["src/list.ts"] },
        model: MODEL,
      }),
    ).toMatchObject({ taskId: "T-1", status: "done" });
    expect(
      await call("submit_phase", {
        phase: "build",
        documents: ["docs/build-notes.md"],
        skillsUsed: [{ skill: "made-up-tdd", evidence: "every task test-first" }],
        memoryUpdate: { files: ["docs/build-notes.md"] },
        model: MODEL,
      }),
    ).toMatchObject({ phase: "build", status: "awaiting_review" });

    // 7. Extension: the person approves the build in the editor.
    const shown: string[] = [];
    const ui: GateUi = { confirm: async () => true, choose: async () => undefined, askNotes: async () => undefined, show: (m) => void shown.push(m) };
    await approvePhase(await openStore(), EDITOR_PERSON, ui);

    // One memory, every channel recorded as itself.
    const store = await openStore();
    const state = await store.readState();
    expect(state.phases.build?.status).toBe("approved");
    expect(state.tasks).toEqual([expect.objectContaining({ id: "T-1", status: "done" })]);

    const events = (await store.readEvents()).events;
    const find = (type: string, phase?: string) =>
      events.find((e) => e.type === type && (phase === undefined || (e.payload as { phase?: string }).phase === phase));
    expect(find("phase_approved", "architecture")?.actor).toEqual(DESKTOP_PERSON);
    expect(find("session_started")?.actor).toMatchObject({ kind: "agent", tool: "made-up-agent" });
    expect(find("phase_started", "idea-review")?.actor).toMatchObject({ kind: "agent", tool: "omni-desktop", model: MODEL });
    expect(find("task_completed")?.actor).toMatchObject({ kind: "agent", tool: "made-up-agent", model: MODEL });
    expect(find("phase_submitted", "build")?.actor).toMatchObject({ kind: "agent", tool: "made-up-agent" });
    expect(find("phase_approved", "build")?.actor).toEqual(EDITOR_PERSON);

    // The app's project page (history and workflow chart) shows the same story from memory.
    const detail = await loadProjectDetail(invoke, root);
    if (!detail.ok) throw new Error(JSON.stringify(detail));
    const nodes = detail.workflow?.nodes ?? [];
    for (const id of ["phase:idea-review", "phase:research", "phase:prd", "phase:architecture", "phase:build", "task:T-1"]) {
      expect(nodes.find((n) => n.id === id)?.status, id).toMatch(/approved|done/);
    }
    // About 1 s alone; dozens of real-file steps run several times slower under the full parallel suite.
  }, 30_000);
});
