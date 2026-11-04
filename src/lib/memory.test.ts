// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore, refreshMemoryDocs } from "@omni/core";
import { createNodeFs } from "@omni/core/node";
import { addEntry, loadMemoryFiles, MEMORY_FILES, updateProjectDetails } from "./memory";
import { DESKTOP_PERSON } from "./decisions";
import { fakeInvoke, appStoreOptions } from "./testing/fake-invoke";

// E3 slice 4a: view project memory; add the person's own decisions, problems and lessons.

const node = createNodeFs();
let base: string;
let root: string;
let store: MemoryStore;

beforeEach(async () => {
  base = mkdtempSync(join(tmpdir(), "omni-app-memory-"));
  root = join(base, "orbit").replace(/\\/g, "/");
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "docs", "ARCHITECTURE.md"), "# Architecture\n");
  const created = await MemoryStore.create(node, root, { name: "Orbit", flow: "build", mode: "full", actor: DESKTOP_PERSON }, appStoreOptions());
  if (!created.ok) throw new Error(JSON.stringify(created.issues));
  store = created.store;
  await refreshMemoryDocs(store);
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe("project memory in the app", () => {
  it("reads every memory file the dashboard shows, in a fixed order", async () => {
    const files = await loadMemoryFiles(fakeInvoke(), root);
    if (!files.ok) throw new Error(files.error);
    expect(files.files.map((f) => f.name)).toEqual([...MEMORY_FILES]);
    expect(files.files.find((f) => f.name === "summary.md")!.content).toContain("# Orbit");
    expect(JSON.parse(files.files.find((f) => f.name === "project.json")!.content!).name).toBe("Orbit");
  });

  it("adds a decision as the person, pointing at a real file, and it appears in decisions.md", async () => {
    const result = await addEntry(fakeInvoke(), root, {
      kind: "decision",
      title: "Use SQLite",
      decision: "Store tasks in SQLite",
      reason: "Single user, local only",
      files: ["docs/ARCHITECTURE.md"],
      commits: [],
    });
    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect((await store.readEvents()).events.at(-1)).toEqual(expect.objectContaining({ type: "decision_recorded", actor: DESKTOP_PERSON }));
    const files = await loadMemoryFiles(fakeInvoke(), root);
    if (!files.ok) throw new Error(files.error);
    expect(files.files.find((f) => f.name === "decisions.md")!.content).toContain("Use SQLite");
  });

  it("refuses a decision that points at a file that does not exist, with the reason", async () => {
    const result = await addEntry(fakeInvoke(), root, { kind: "decision", title: "t", decision: "d", reason: "r", files: ["docs/NOPE.md"], commits: [] });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/docs\/NOPE\.md: missing/);
  });

  it("adds a problem and a lesson", async () => {
    const problem = await addEntry(fakeInvoke(), root, { kind: "problem", title: "Slow start", details: "4 s on a cold start", status: "open", files: ["docs/ARCHITECTURE.md"], commits: [] });
    expect(problem.ok).toBe(true);
    const lesson = await addEntry(fakeInvoke(), root, { kind: "lesson", lesson: "Named tools are examples of a category", context: "idea review" });
    expect(lesson.ok).toBe(true);
    const types = (await store.readEvents()).events.map((e) => e.type);
    expect(types.slice(-2)).toEqual(["problem_recorded", "lesson_recorded"]);
  });

  it("says a commit could not be checked here, instead of claiming it was", async () => {
    const result = await addEntry(fakeInvoke(), root, { kind: "decision", title: "t", decision: "d", reason: "r", files: [], commits: ["a1b2c3d"] });
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/a1b2c3d could not be verified/);
  });
});

describe("project details (E3 slice 4b)", () => {
  it("renames the project as the person and refreshes the summary", async () => {
    const result = await updateProjectDetails(fakeInvoke(), root, { name: "Orbit planner" });
    expect(result).toEqual({ ok: true, message: "Project details saved." });
    expect((await store.readEvents()).events.at(-1)).toEqual(expect.objectContaining({ type: "project_updated", actor: DESKTOP_PERSON }));
    const files = await loadMemoryFiles(fakeInvoke(), root);
    if (!files.ok) throw new Error(files.error);
    expect(files.files.find((f) => f.name === "summary.md")!.content).toContain("# Orbit planner");
  });

  it("refuses an empty name with the reason", async () => {
    const result = await updateProjectDetails(fakeInvoke(), root, { name: "" });
    expect(result.ok).toBe(false);
    expect(result.message.length).toBeGreaterThan(0);
  });
});
