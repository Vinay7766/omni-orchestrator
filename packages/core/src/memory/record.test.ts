import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "./store.js";
import { createNodeFs } from "./node-fs.js";
import { recordDecision, recordLesson, recordProblem } from "./record.js";

// Decisions, problems and lessons (MEM-2, MEM-4, UND-5), shared by the MCP server and the app.

const fs = createNodeFs();
const person = { kind: "human" as const, tool: "omni-desktop" };
let root: string;
let store: MemoryStore;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "omni-record-")).replace(/\\/g, "/");
  mkdirSync(join(root, "docs"));
  writeFileSync(join(root, "docs", "ARCHITECTURE.md"), "# Architecture\n");
  const created = await MemoryStore.create(fs, root, { name: "p", flow: "build", mode: "full", actor: person });
  if (!created.ok) throw new Error(JSON.stringify(created.issues));
  store = created.store;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const decision = { title: "Use SQLite", decision: "Store tasks in SQLite", reason: "Single user, local only", refs: { files: ["docs/ARCHITECTURE.md"] } };

describe("record (core)", () => {
  it("records a decision that points at a real file, and refreshes decisions.md", async () => {
    const result = await recordDecision({ store, fs, root }, person, decision);
    expect(result.ok).toBe(true);
    const last = (await store.readEvents()).events.at(-1)!;
    expect(last).toEqual(expect.objectContaining({ type: "decision_recorded", actor: person, refs: { files: ["docs/ARCHITECTURE.md"] } }));
    expect(await readFile(join(root, ".agents", "decisions.md"), "utf8")).toContain("Use SQLite");
  });

  it("refuses a decision or problem that points at nothing", async () => {
    const d = await recordDecision({ store, fs, root }, person, { ...decision, refs: {} });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.message).toMatch(/at least one file or commit/);
    const p = await recordProblem({ store, fs, root }, person, { title: "Slow start", details: "4 s", status: "open", refs: {} });
    expect(p.ok).toBe(false);
  });

  it("refuses a reference to a file that does not exist", async () => {
    const result = await recordDecision({ store, fs, root }, person, { ...decision, refs: { files: ["docs/MISSING.md"] } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/docs\/MISSING\.md: missing/);
  });

  it("records a commit it cannot check as unverified, with a warning, never as verified", async () => {
    const result = await recordDecision({ store, fs, root }, person, { ...decision, refs: { commits: ["a1b2c3d"] } });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings.join(" ")).toMatch(/a1b2c3d could not be verified/);
  });

  it("records a lesson without references", async () => {
    const result = await recordLesson({ store, fs, root }, person, { lesson: "Named tools are examples of a category" });
    expect(result.ok).toBe(true);
    expect((await store.readEvents()).events.at(-1)!.type).toBe("lesson_recorded");
  });
});
