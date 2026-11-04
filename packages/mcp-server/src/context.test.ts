import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore, type CatalogEntry, type SkillSource } from "@omni/core";
import { createNodeFs } from "@omni/core/node";
import { buildContext } from "./context.js";

const fs = createNodeFs();
const person = { kind: "human" as const, tool: "made-up-app" };
const agent = { kind: "agent" as const, tool: "made-up-agent" };

const entry = (id: string, phases: string[]): CatalogEntry => ({
  id,
  name: id,
  description: `A made-up skill called ${id}.`,
  category: "engineering",
  attribution: { name: "Someone", sourceUrl: "https://example.com", verified: true },
  enabled: true,
  isCustom: false,
  license: "MIT",
  phases,
  domains: ["testing"],
});

const skills = (entries: CatalogEntry[]): SkillSource => ({
  list: async () => ({ ok: true, entries }),
  readContent: async () => null,
});
const catalog = skills([entry("plan-well", ["idea-review"]), entry("build-well", ["build"]), entry("always", ["all"])]);

let root: string;
let store: MemoryStore;
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "omni-mcp-ctx-")).replace(/\\/g, "/");
  const created = await MemoryStore.create(fs, root, { name: "Orbit planner", flow: "build", mode: "full", actor: person });
  if (!created.ok) throw new Error(JSON.stringify(created.issues));
  store = created.store;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const event = async (type: Parameters<MemoryStore["appendEvent"]>[0]["type"], payload: Record<string, unknown>) => {
  const result = await store.appendEvent({ type, actor: agent, payload });
  if (!result.ok) throw new Error(JSON.stringify(result));
};
const context = async (startDir = root, projectPath?: string, source = catalog, registered: string[] = []) => {
  const result = await buildContext(
    { fs, skills: source, startDir, registeredProjects: async () => registered },
    projectPath === undefined ? {} : { projectPath },
  );
  if (!result.ok) throw new Error(result.message);
  return result.context;
};

describe("buildContext", () => {
  it("gives a new project its summary and says no phase has started", async () => {
    const ctx = await context();
    expect(ctx.project.name).toBe("Orbit planner");
    expect(ctx.project.root).toBe(root);
    expect(ctx.summary).toMatch(/^# Orbit planner/);
    expect(ctx.phase).toEqual({ id: null, status: null });
    expect(ctx.skills).toEqual([]);
    expect(ctx.warnings.join(" ")).toMatch(/no phase has started/i);
  });

  it("returns the current phase with its own skills first", async () => {
    await event("phase_started", { phase: "build" });
    const ctx = await context();
    expect(ctx.phase).toEqual({ id: "build", status: "in_progress" });
    expect(ctx.skills.map((s) => [s.id, s.reason])).toEqual([
      ["build-well", "phase"],
      ["always", "all-phases"],
    ]);
    expect(Object.keys(ctx.skills[0]).sort()).toEqual(["description", "id", "name", "reason"]);
  });

  it("applies the project's skills.json overrides", async () => {
    await event("phase_started", { phase: "build" });
    writeFileSync(join(root, ".agents", "skills.json"), JSON.stringify({ formatVersion: 1, skills: { always: { enabled: false } } }));
    expect((await context()).skills.map((s) => s.id)).toEqual(["build-well"]);
  });

  it("ignores an invalid skills.json and says so", async () => {
    await event("phase_started", { phase: "build" });
    writeFileSync(join(root, ".agents", "skills.json"), "{ not json");
    const ctx = await context();
    expect(ctx.skills.map((s) => s.id)).toEqual(["build-well", "always"]);
    expect(ctx.warnings.join(" ")).toMatch(/skills\.json/);
  });

  it("ignores a skills.json with the wrong shape and says so", async () => {
    await event("phase_started", { phase: "build" });
    writeFileSync(join(root, ".agents", "skills.json"), JSON.stringify({ formatVersion: 1, skills: { always: { enabled: "no" } } }));
    const ctx = await context();
    expect(ctx.skills.map((s) => s.id)).toEqual(["build-well", "always"]);
    expect(ctx.warnings.join(" ")).toMatch(/skills\.json is invalid/);
  });

  it("still answers when the skill catalog cannot be read", async () => {
    await event("phase_started", { phase: "build" });
    const broken: SkillSource = { list: async () => ({ ok: false, issues: [{ path: "", message: "catalog missing" }] }), readContent: async () => null };
    const ctx = await context(root, undefined, broken);
    expect(ctx.skills).toEqual([]);
    expect(ctx.warnings.join(" ")).toMatch(/catalog missing/);
  });

  it("names the tasks in progress and the next one to do", async () => {
    await event("task_created", { taskId: "T-1", title: "Schema" });
    await event("task_created", { taskId: "T-2", title: "Parser" });
    await event("task_created", { taskId: "T-3", title: "Screens" });
    await event("task_marked_trivial", { taskId: "T-1", reason: "One-line change" });
    await event("task_started", { taskId: "T-1" });
    const ctx = await context();
    expect(ctx.tasks.inProgress.map((t) => t.id)).toEqual(["T-1"]);
    expect(ctx.tasks.next?.id).toBe("T-2");
    expect(ctx.tasks).toMatchObject({ done: 0, total: 3 });
  });

  it("offers a task that is ready to start (designed) as the next one", async () => {
    await event("task_created", { taskId: "T-1", title: "Ready" });
    await event("task_marked_trivial", { taskId: "T-1", reason: "Small" });
    expect((await context()).tasks.next).toMatchObject({ id: "T-1", status: "designed" });
  });

  it("has no next task when every task is done", async () => {
    await event("task_created", { taskId: "T-1", title: "Only" });
    await event("task_marked_trivial", { taskId: "T-1", reason: "Tiny" });
    await event("task_started", { taskId: "T-1" });
    await event("task_completed", {
      taskId: "T-1",
      summary: "Done it",
      skillsUsed: [{ skill: "build-well", evidence: "Wrote the failing test first" }],
      tests: { command: "npm test", exitCode: 0, outputTail: "1 passed" },
    });
    const ctx = await context();
    expect(ctx.tasks).toMatchObject({ inProgress: [], next: null, done: 1, total: 1 });
  });

  it("returns the five newest decisions, newest first, and every lesson", async () => {
    for (let i = 1; i <= 7; i++) await event("decision_recorded", { title: `D${i}`, decision: `Use ${i}`, reason: `Because ${i}` });
    await event("lesson_recorded", { lesson: "Tools are examples of a category" });
    const ctx = await context();
    expect(ctx.recentDecisions.map((d) => d.title)).toEqual(["D7", "D6", "D5", "D4", "D3"]);
    expect(ctx.recentDecisions[0]).toMatchObject({ decision: "Use 7", reason: "Because 7" });
    expect(ctx.lessons).toEqual(["Tools are examples of a category"]);
  });

  it("prefers the saved summary.md when there is one", async () => {
    writeFileSync(join(root, ".agents", "summary.md"), "# Saved summary\n");
    expect((await context()).summary).toBe("# Saved summary\n");
  });

  it("finds the project from a nested folder and from a relative projectPath to a registered project", async () => {
    mkdirSync(join(root, "src", "deep"), { recursive: true });
    expect((await context(`${root}/src/deep`)).project.root).toBe(root);
    const outside = mkdtempSync(join(tmpdir(), "omni-mcp-out-")).replace(/\\/g, "/");
    try {
      const relative = join("..", root.split("/").pop()!);
      expect((await context(outside, relative, catalog, [root])).project.root).toBe(root);
      // Not registered: refused (RT-14).
      await expect(context(outside, relative)).rejects.toThrow(/not a project this server may use/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("follows a .agents-link from another checkout to a registered project and says so", async () => {
    const worktree = mkdtempSync(join(tmpdir(), "omni-mcp-wt-")).replace(/\\/g, "/");
    try {
      writeFileSync(join(worktree, ".agents-link"), JSON.stringify({ formatVersion: 1, projectRoot: root }));
      const ctx = await context(worktree, undefined, catalog, [root]);
      expect(ctx.project.root).toBe(root);
      expect(ctx.project.linkedFrom).toBe(worktree);
      // A link to a project the person did not register is not followed (RT-15).
      await expect(context(worktree)).rejects.toThrow(/not a project this server may use/);
    } finally {
      rmSync(worktree, { recursive: true, force: true });
    }
  });

  it("explains what to do when there is no project", async () => {
    const empty = mkdtempSync(join(tmpdir(), "omni-mcp-none-")).replace(/\\/g, "/");
    try {
      const result = await buildContext({ fs, skills: catalog, startDir: empty }, {});
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toMatch(/no OmniOrchestrator project.*projectPath/s);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
