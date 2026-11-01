import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore, type CatalogEntry, type SkillSource } from "@omni/core";
import { createNodeFs } from "@omni/core/node";
import { getPhaseSkills } from "./phase-tools.js";

const fs = createNodeFs();
const agent = { kind: "agent" as const, tool: "made-up-agent" };

const entry = (id: string, phases: string[]): CatalogEntry => ({
  id,
  name: `Skill ${id}`,
  description: `A made-up skill called ${id}.`,
  category: "engineering",
  attribution: { name: "Someone", sourceUrl: "https://example.com", verified: true },
  enabled: true,
  isCustom: false,
  license: "MIT",
  phases,
  domains: ["testing"],
});

const skills: SkillSource = {
  list: async () => ({ ok: true, entries: [entry("build-well", ["build"]), entry("plan-well", ["prd"]), entry("always", ["all"])] }),
  readContent: async (id) => (id === "missing-text" ? null : `# ${id}\nFull instructions for ${id}.\n`),
};

let root: string;
let store: MemoryStore;
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "omni-mcp-phase-")).replace(/\\/g, "/");
  const created = await MemoryStore.create(fs, root, { name: "Orbit planner", flow: "build", mode: "full", actor: agent });
  if (!created.ok) throw new Error(JSON.stringify(created.issues));
  store = created.store;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const startPhase = async (phase: string) => {
  const r = await store.appendEvent({ type: "phase_started", actor: agent, payload: { phase } });
  if (!r.ok) throw new Error(JSON.stringify(r));
};
const deps = { fs, skills, startDir: "" };
const call = (input: { ids?: string[] } = {}) => getPhaseSkills({ ...deps, startDir: root }, input);

describe("get_phase_skills", () => {
  it("returns the full text of the current phase's skills only", async () => {
    await startPhase("build");
    const result = await call();
    if (!result.ok) throw new Error(result.message);
    expect(result.value.phase).toBe("build");
    expect(result.value.skills.map((s) => s.id)).toEqual(["build-well", "always"]);
    expect(result.value.skills[0]).toMatchObject({
      name: "Skill build-well",
      reason: "phase",
      license: "MIT",
      content: "# build-well\nFull instructions for build-well.\n",
    });
  });

  it("loads only the requested skills of the phase", async () => {
    await startPhase("build");
    const result = await call({ ids: ["always"] });
    if (!result.ok) throw new Error(result.message);
    expect(result.value.skills.map((s) => s.id)).toEqual(["always"]);
  });

  it("refuses a skill that is not part of the current phase and lists the allowed ones", async () => {
    await startPhase("build");
    const result = await call({ ids: ["plan-well"] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/plan-well.*build-well, always/s);
  });

  it("says a phase must start first", async () => {
    const result = await call();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/no phase has started/i);
  });

  it("warns, rather than fails, when a skill's text is missing", async () => {
    await startPhase("build");
    const missing: SkillSource = {
      list: async () => ({ ok: true, entries: [entry("missing-text", ["build"])] }),
      readContent: async () => null,
    };
    const result = await getPhaseSkills({ fs, skills: missing, startDir: root }, {});
    if (!result.ok) throw new Error(result.message);
    expect(result.value.skills).toEqual([]);
    expect(result.value.warnings.join(" ")).toMatch(/missing-text/);
  });
});
