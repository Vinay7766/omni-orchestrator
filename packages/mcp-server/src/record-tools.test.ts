import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore, type CommitChecker, type SkillSource } from "@omni/core";
import { createNodeFs } from "@omni/core/node";
import { recordDecision, recordLesson, recordProblem } from "./record-tools.js";

const fs = createNodeFs();
const actor = { kind: "agent" as const, tool: "made-up-client" };
const skills: SkillSource = { list: async () => ({ ok: true, entries: [] }), readContent: async () => null };
const commits: CommitChecker = { exists: async (_root, sha) => (sha === "abc1234" ? "yes" : "no") };

let root: string;
let store: MemoryStore;
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "omni-mcp-rec-")).replace(/\\/g, "/");
  const created = await MemoryStore.create(fs, root, { name: "Orbit planner", flow: "build", mode: "full", actor });
  if (!created.ok) throw new Error(JSON.stringify(created.issues));
  store = created.store;
  mkdirSync(join(root, "docs"));
  writeFileSync(join(root, "docs", "architecture.md"), "# Architecture\n");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const deps = (withGit = true) => ({ fs, skills, startDir: root, ...(withGit ? { commits } : {}) });
const eventCount = async () => (await store.readEvents()).events.length;
const memoryFile = (name: string) => readFileSync(join(root, ".agents", name), "utf8");

const decision = {
  title: "Store memory as files",
  decision: "Use JSON and Markdown in .agents/",
  reason: "Readable by every tool and by people",
  alternatives: ["SQLite"],
  refs: { files: ["docs/architecture.md"], commits: ["abc1234"] },
};

describe("record_decision", () => {
  it("records the decision and refreshes decisions.md", async () => {
    const result = await recordDecision(deps(), actor, decision);
    if (!result.ok) throw new Error(result.message);
    expect(result.value).toMatchObject({ type: "decision_recorded", warnings: [] });
    const last = (await store.readEvents()).events.at(-1)!;
    expect(last.id).toBe(result.value.eventId);
    expect(last.actor).toEqual(actor);
    expect(last.refs).toEqual(decision.refs);
    expect(memoryFile("decisions.md")).toContain("## Store memory as files");
  });

  const invalid: [string, Record<string, unknown>, RegExp][] = [
    ["no references at all", { files: [], commits: [] }, /at least one file or commit/],
    ["a file that does not exist", { files: ["docs/nowhere.md"] }, /docs\/nowhere\.md: missing/],
    ["a path outside the project", { files: ["../secrets.txt"] }, /\.\.\/secrets\.txt: invalid/],
    ["an absolute path", { files: ["/etc/hosts"] }, /\/etc\/hosts: invalid/],
    ["something that is not a commit", { commits: ["main"] }, /main: invalid/],
    ["a commit that does not exist", { commits: ["fff0000"] }, /fff0000: missing/],
  ];
  for (const [name, refs, message] of invalid) {
    it(`rejects ${name} and writes nothing`, async () => {
      const before = await eventCount();
      const result = await recordDecision(deps(), actor, { ...decision, refs });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toMatch(message);
      expect(await eventCount()).toBe(before);
    });
  }

  it("accepts a commit it cannot verify, with a warning", async () => {
    const result = await recordDecision(deps(false), actor, decision);
    if (!result.ok) throw new Error(result.message);
    expect(result.value.warnings.join(" ")).toMatch(/abc1234/);
  });

  it("keeps secrets out of memory", async () => {
    const leaked = "ghp_" + "a".repeat(36);
    const result = await recordDecision(deps(), actor, { ...decision, reason: `token ${leaked} was in the config` });
    if (!result.ok) throw new Error(result.message);
    expect(readFileSync(join(root, ".agents", "events.jsonl"), "utf8")).not.toContain(leaked);
    expect(memoryFile("decisions.md")).not.toContain(leaked);
  });
});

describe("record_problem", () => {
  const problem = { title: "Lock times out on slow disks", details: "Seen on network drives", status: "open" as const, refs: { files: ["docs/architecture.md"] } };

  it("records an open problem, then its resolution under the same title", async () => {
    const opened = await recordProblem(deps(), actor, problem);
    if (!opened.ok) throw new Error(opened.message);
    expect(opened.value.status).toBe("open");
    expect(memoryFile("problems.md").split("## Resolved")[0]).toContain("Lock times out on slow disks");

    const resolved = await recordProblem(deps(), actor, { ...problem, details: "Raised the stale timeout", status: "resolved" });
    if (!resolved.ok) throw new Error(resolved.message);
    const [openPart, rest] = memoryFile("problems.md").split("## Resolved");
    expect(openPart).not.toContain("Lock times out on slow disks");
    expect(rest).toContain("Raised the stale timeout");
  });

  it("needs at least one reference", async () => {
    const result = await recordProblem(deps(), actor, { ...problem, refs: {} });
    expect(result.ok).toBe(false);
  });
});

describe("record_lesson", () => {
  it("records a correction without references, and serves it in lessons.md", async () => {
    const result = await recordLesson(deps(), actor, { lesson: "Named tools are examples of a category", context: "idea review" });
    if (!result.ok) throw new Error(result.message);
    expect(memoryFile("lessons.md")).toContain("Named tools are examples of a category (idea review)");
  });

  it("still checks references when they are given", async () => {
    const result = await recordLesson(deps(), actor, { lesson: "x", refs: { files: ["docs/nowhere.md"] } });
    expect(result.ok).toBe(false);
  });
});
