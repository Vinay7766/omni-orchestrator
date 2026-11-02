// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore, PhaseEngine, type Invoke } from "@omni/core";
import { createNodeFs } from "@omni/core/node";
import { loadProjectDetail, loadProjects } from "./projects";

const node = createNodeFs();
const agent = { kind: "agent" as const, tool: "made-up-agent" };

let base: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "omni-app-projects-"));
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

/**
 * The app's Tauri commands, run on real files: memfs_* as the Rust side does them (C9's contract)
 * and find_projects returning what the Rust scan would for these folders.
 */
function fakeInvoke(roots: string[], errors: string[] = []): Invoke {
  const a = (args: Record<string, unknown>, key: string) => args[key] as string;
  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    find_projects: async () => ({ roots, errors }),
    memfs_read_text: (x) => node.readText(a(x, "path")),
    memfs_write_text: (x) => node.writeText(a(x, "path"), a(x, "content")),
    memfs_append_text: (x) => node.appendText(a(x, "path"), a(x, "content")),
    memfs_create_exclusive: (x) => node.createExclusive(a(x, "path"), a(x, "content")),
    memfs_exists: (x) => node.exists(a(x, "path")),
    memfs_mkdir: (x) => node.mkdir(a(x, "path")),
    memfs_rename: (x) => node.rename(a(x, "from"), a(x, "to")),
    memfs_remove: (x) => node.remove(a(x, "path")),
    memfs_list: (x) => node.list(a(x, "path")),
  };
  return (command, args) => {
    const handler = handlers[command];
    return handler ? handler(args) : Promise.reject(`Unexpected command: ${command}`);
  };
}

async function project(name: string, phase?: string) {
  const root = join(base, name);
  mkdirSync(root);
  const created = await MemoryStore.create(node, root, { name, flow: "build", mode: "full", actor: agent });
  if (!created.ok) throw new Error(JSON.stringify(created.issues));
  if (phase) await new PhaseEngine(created.store).start(agent, phase);
  return root;
}

describe("loadProjects", () => {
  it("reads each found project's overview through core", async () => {
    const orbit = await project("Orbit planner", "idea-review");
    const nebula = await project("Nebula notes");
    const result = await loadProjects(fakeInvoke([nebula, orbit]), [base]);
    expect(result.errors).toEqual([]);
    expect(result.projects.map((p) => [p.root, p.ok ? p.overview.name : "error"])).toEqual([
      [nebula, "Nebula notes"],
      [orbit, "Orbit planner"],
    ]);
    const first = result.projects[1];
    if (!first.ok) throw new Error(first.error);
    expect(first.overview.phase).toEqual({ id: "idea-review", status: "in_progress" });
  });

  it("shows a project whose memory cannot be read as an error, not as made-up data", async () => {
    const broken = join(base, "broken");
    mkdirSync(join(broken, ".agents"), { recursive: true });
    writeFileSync(join(broken, ".agents", "project.json"), "{ not json");
    const result = await loadProjects(fakeInvoke([broken]), [base]);
    expect(result.projects).toHaveLength(1);
    const row = result.projects[0];
    expect(row.ok).toBe(false);
    if (!row.ok) expect(row.error).toMatch(/project\.json/);
  });

  it("passes on the folders the scan could not use", async () => {
    const result = await loadProjects(fakeInvoke([], ["relative is not an absolute folder path."]), ["relative"]);
    expect(result).toEqual({ projects: [], errors: ["relative is not an absolute folder path."] });
  });

  it("does not ask the backend anything when no folders are configured", async () => {
    const result = await loadProjects(() => Promise.reject("must not be called"), []);
    expect(result).toEqual({ projects: [], errors: [] });
  });
});

describe("loadProjectDetail (E3)", () => {
  it("reads a real project's name and phase history over the app's file commands", async () => {
    const root = await project("orbit", "idea-review");
    const detail = await loadProjectDetail(fakeInvoke([]), root);
    if (!detail.ok) throw new Error(detail.error);
    expect(detail.name).toBe("orbit");
    expect(detail.history.map((h) => h.phase)[0]).toBe("idea-review");
    expect(detail.history[0].status).toBe("in_progress");
    expect(detail.history[0].started?.by).toEqual(agent);
  });

  it("reports the real reason when a folder is not a readable project", async () => {
    const empty = join(base, "not-a-project");
    mkdirSync(empty);
    const detail = await loadProjectDetail(fakeInvoke([]), empty);
    expect(detail.ok).toBe(false);
    if (!detail.ok) expect(detail.error.length).toBeGreaterThan(0);
  });
});
