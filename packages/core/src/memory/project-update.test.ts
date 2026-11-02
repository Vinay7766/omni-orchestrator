import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "./store.js";
import { createNodeFs } from "./node-fs.js";

// E3 slice 4b (APP-2): a person changes the project's name or mode; recorded, schema-checked.

const fs = createNodeFs();
const person = { kind: "human" as const, tool: "omni-desktop" };
const agent = { kind: "agent" as const, tool: "made-up-agent" };
let root: string;
let store: MemoryStore;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "omni-project-update-")).replace(/\\/g, "/");
  const created = await MemoryStore.create(fs, root, { name: "Orbit", flow: "build", mode: "full", actor: person });
  if (!created.ok) throw new Error(JSON.stringify(created.issues));
  store = created.store;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const projectFile = async () => JSON.parse(await readFile(join(root, ".agents", "project.json"), "utf8"));
const messages = (r: { ok: boolean; issues?: { message: string }[] }) => (r.ok ? "" : r.issues!.map((i) => i.message).join(" | "));

describe("MemoryStore.updateProject", () => {
  it("changes the name and mode for a person, in project.json and in the log", async () => {
    const result = await store.updateProject(person, { name: "Orbit planner", mode: "simple" });
    expect(result.ok, messages(result)).toBe(true);
    expect(store.readProject()).toEqual(expect.objectContaining({ name: "Orbit planner", mode: "simple", flow: "build" }));
    expect(await projectFile()).toEqual(expect.objectContaining({ name: "Orbit planner", mode: "simple" }));
    const last = (await store.readEvents()).events.at(-1)!;
    expect(last).toEqual(expect.objectContaining({ type: "project_updated", actor: person, payload: { name: "Orbit planner", mode: "simple" } }));
  });

  it("is seen by the next tool that opens the project", async () => {
    await store.updateProject(person, { name: "Orbit planner" });
    const reopened = await MemoryStore.open(fs, root);
    if (!reopened.ok) throw new Error(JSON.stringify(reopened.issues));
    expect(reopened.store.readProject().name).toBe("Orbit planner");
  });

  it("refuses an agent and writes nothing", async () => {
    const result = await store.updateProject(agent, { name: "Renamed by an agent" });
    expect(result.ok).toBe(false);
    expect(messages(result)).toMatch(/Only a person can change/);
    expect((await projectFile()).name).toBe("Orbit");
  });

  it("refuses values the project schema does not allow, and writes nothing", async () => {
    const empty = await store.updateProject(person, { name: "" });
    expect(empty.ok).toBe(false);
    const tooLong = await store.updateProject(person, { name: "x".repeat(201) });
    expect(tooLong.ok).toBe(false);
    expect((await projectFile()).name).toBe("Orbit");
  });

  it("refuses a change that changes nothing", async () => {
    const result = await store.updateProject(person, { name: "Orbit", mode: "full" });
    expect(result.ok).toBe(false);
    expect(messages(result)).toMatch(/nothing to change/);
  });
});
