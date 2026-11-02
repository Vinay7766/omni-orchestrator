// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore, PhaseEngine, type Invoke } from "@omni/core";
import { createNodeFs } from "@omni/core/node";
import { approveTaskList, parseTaskProposal, proposeTasks, readTaskProposal } from "./task-proposal";
import { createProjectFromIdea } from "./planning";
import { DESKTOP_PERSON } from "./decisions";
import { fakeInvoke } from "./testing/fake-invoke";
import type { Skill } from "./types";

// E5 slice 5: after architecture is approved, the AI set up in the app writes the task list,
// each task tagged with the kinds of work it involves; the person approves it (tasks are
// created) or asks for changes (the AI rewrites it). The person never edits the list by hand.

const node = createNodeFs();
const agent = { kind: "agent" as const, tool: "omni-desktop", model: "made-up-model" };

const breakdown: Skill = {
  id: "planning-and-task-breakdown",
  name: "Task breakdown",
  description: "Breaks work into ordered tasks",
  category: "strategy",
  attribution: { name: "Made-up Author", sourceUrl: "https://example.org", verified: true },
  enabled: true,
  content: "BREAKDOWN METHOD",
  isCustom: false,
  phases: ["architecture"],
  license: "MIT",
};

const proposal = (tasks: unknown) => `Here is the plan.\n\n\`\`\`json\n${JSON.stringify({ tasks })}\n\`\`\`\n`;
const TWO = [
  { title: "Shopping list data model", requirements: ["REQ-1"], kinds: ["backend", "tests"] },
  { title: "List screen", requirements: ["REQ-2"], kinds: ["Interface"] },
];

describe("parseTaskProposal", () => {
  it("reads the tasks, numbers them and normalises tag case", () => {
    expect(parseTaskProposal(proposal(TWO))).toEqual({
      ok: true,
      tasks: [
        { taskId: "T-1", title: "Shopping list data model", requirements: ["REQ-1"], kinds: ["backend", "tests"] },
        { taskId: "T-2", title: "List screen", requirements: ["REQ-2"], kinds: ["interface"] },
      ],
    });
  });

  it("refuses an answer without a JSON block", () => {
    expect(parseTaskProposal("1. Build it")).toMatchObject({ ok: false });
  });

  it("refuses a task without kinds", () => {
    const parsed = parseTaskProposal(proposal([{ title: "List screen" }]));
    expect(parsed).toMatchObject({ ok: false });
    if (!parsed.ok) expect(parsed.error).toMatch(/kinds/);
  });

  it("refuses a kind that is not a short tag", () => {
    expect(parseTaskProposal(proposal([{ title: "x", kinds: ["user interface!"] }]))).toMatchObject({ ok: false });
  });

  it("refuses an empty list", () => {
    expect(parseTaskProposal(proposal([]))).toMatchObject({ ok: false });
  });
});

describe("proposing and approving the task list", () => {
  let base: string;
  let root: string;
  let prompts: string[];
  let reply: () => Promise<unknown>;
  const invoke: Invoke = (command, args) => {
    if (command === "byok_complete") {
      prompts.push((args.request as { prompt: string }).prompt);
      return reply();
    }
    return fakeInvoke()(command, args);
  };
  const byok = { ollamaEndpoint: "http://localhost:11434", preferredModel: "made-up-model" };
  const open = async () => {
    const opened = await MemoryStore.open(node, root);
    if (!opened.ok) throw new Error(JSON.stringify(opened.issues));
    return opened.store;
  };

  beforeEach(async () => {
    base = mkdtempSync(join(tmpdir(), "omni-app-tasks-")).replace(/\\/g, "/");
    const created = await createProjectFromIdea(fakeInvoke(), { parent: base, name: "Orbit", idea: "A shared shopping list" });
    if (!created.ok) throw new Error(created.error);
    root = created.root;
    await invoke("write_planning_document", { root, name: "prd.md", content: "# PRD\n\nREQ-1 lists. REQ-2 screen." });
    await invoke("write_planning_document", { root, name: "architecture.md", content: "# Architecture\n\nTwo parts." });
    const store = await open();
    const engine = new PhaseEngine(store);
    for (const phase of ["idea-review", "research", "prd", "architecture"]) {
      await engine.start(agent, phase);
      await store.appendEvent({ type: "memory_updated", actor: agent, payload: { files: [`docs/planning/${phase}.md`] } });
      await engine.submit(agent, {
        phase,
        documents: [`docs/planning/${phase}.md`],
        skillsUsed: [{ skill: "x", evidence: "y" }],
        understandingCheck: "docs/planning/u.md",
        ...(phase === "architecture" ? { stackAdr: "docs/planning/architecture-stack-adr.md" } : {}),
      });
      await engine.approve(DESKTOP_PERSON, phase);
    }
    await engine.start(DESKTOP_PERSON, "build");
    prompts = [];
    reply = () => Promise.resolve({ text: proposal(TWO), provider: "ollama", model: "made-up-model" });
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it("asks the model with the approved PRD and architecture and the breakdown skill, and saves the proposal", async () => {
    const r = await proposeTasks(invoke, root, { byok, skills: [breakdown] });
    expect(r).toMatchObject({ ok: true });
    expect(prompts[0]).toContain("REQ-1 lists");
    expect(prompts[0]).toContain("Two parts.");
    expect(prompts[0]).toContain("BREAKDOWN METHOD");
    expect(prompts[0]).toContain("kinds");
    expect(readFileSync(`${root}/docs/planning/tasks.md`, "utf8")).toContain("List screen");
    const read = await readTaskProposal(invoke, root);
    expect(read).toMatchObject({ ok: true, model: "made-up-model", tasks: [{ taskId: "T-1" }, { taskId: "T-2" }] });
    expect((await (await open()).readState()).tasks).toEqual([]);
  });

  it("saves nothing when the model's list is invalid", async () => {
    reply = () => Promise.resolve({ text: "Tasks: build it all", provider: "ollama", model: "made-up-model" });
    const r = await proposeTasks(invoke, root, { byok, skills: [breakdown] });
    expect(r).toMatchObject({ ok: false });
    expect(existsSync(`${root}/docs/planning/tasks.md`)).toBe(false);
  });

  it("rewrites the list with the person's notes and the list they saw", async () => {
    await proposeTasks(invoke, root, { byok, skills: [breakdown] });
    reply = () => Promise.resolve({ text: proposal([TWO[0]]), provider: "ollama", model: "made-up-model" });
    const r = await proposeTasks(invoke, root, { byok, skills: [breakdown], notes: "Merge the screen into one task" });
    expect(r).toMatchObject({ ok: true });
    expect(prompts[1]).toContain("Merge the screen into one task");
    expect(prompts[1]).toContain("List screen");
    expect((await readTaskProposal(invoke, root)).ok && (await readTaskProposal(invoke, root))).toMatchObject({ tasks: [{ taskId: "T-1" }] });
  });

  it("creates the approved tasks with their kinds and records the person's approval", async () => {
    await proposeTasks(invoke, root, { byok, skills: [breakdown] });
    const r = await approveTaskList(invoke, root);
    expect(r).toMatchObject({ ok: true });

    const store = await open();
    expect((await store.readState()).tasks).toEqual([
      { id: "T-1", title: "Shopping list data model", status: "todo", kinds: ["backend", "tests"] },
      { id: "T-2", title: "List screen", status: "todo", kinds: ["interface"] },
    ]);
    const events = (await store.readEvents()).events;
    const created = events.filter((e) => e.type === "task_created");
    expect(created[0].actor).toEqual(agent);
    expect(created[0].payload).toMatchObject({ requirements: ["REQ-1"] });
    const approval = events.at(-1)!;
    expect(approval.type).toBe("decision_recorded");
    expect(approval.actor).toEqual(DESKTOP_PERSON);
    expect(approval.refs).toEqual({ files: ["docs/planning/tasks.md"] });
  });

  it("will not propose or approve once the project has tasks", async () => {
    await proposeTasks(invoke, root, { byok, skills: [breakdown] });
    await approveTaskList(invoke, root);
    expect(await proposeTasks(invoke, root, { byok, skills: [breakdown] })).toMatchObject({ ok: false });
    expect(await approveTaskList(invoke, root)).toMatchObject({ ok: false });
  });

  it("will not propose before the architecture is approved", async () => {
    const fresh = await createProjectFromIdea(fakeInvoke(), { parent: base, name: "Other", idea: "x" });
    if (!fresh.ok) throw new Error(fresh.error);
    const r = await proposeTasks(invoke, fresh.root, { byok, skills: [breakdown] });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/architecture/);
    expect(prompts).toHaveLength(0);
  });
});
