import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePhaseSkills, type CatalogEntry } from "./resolve.js";
import { createSkillDirectorySource } from "./node-source.js";
import { validateMemoryFile } from "../validate.js";
import { FLOWS } from "../generated/contract.js";

const entry = (id: string, phases: string[], extra: Partial<CatalogEntry> = {}): CatalogEntry => ({
  id,
  name: id,
  description: `A made-up skill called ${id} for tests.`,
  category: "engineering",
  attribution: { name: "Someone", sourceUrl: "https://example.com", verified: true },
  enabled: true,
  isCustom: false,
  license: "MIT",
  phases,
  domains: ["testing"],
  ...extra,
});

const catalog: CatalogEntry[] = [
  entry("alpha", ["build"]),
  entry("everywhere", ["all"]),
  entry("beta", ["build", "review"]),
  entry("gamma", ["prd"]),
  entry("dormant", ["build"], { enabled: false }),
];
const ids = (r: { skills: { id: string }[] }) => r.skills.map((s) => s.id);

describe("resolvePhaseSkills", () => {
  it("offers the phase's own skills first, then skills for every phase, in catalog order", () => {
    expect(ids(resolvePhaseSkills(catalog, null, "build"))).toEqual(["alpha", "beta", "everywhere"]);
  });

  it("never offers skills mapped only to other phases", () => {
    expect(ids(resolvePhaseSkills(catalog, null, "prd"))).toEqual(["gamma", "everywhere"]);
  });

  it("says why each skill was offered", () => {
    const result = resolvePhaseSkills(catalog, null, "build");
    expect(result.skills.find((s) => s.id === "alpha")?.reason).toBe("phase");
    expect(result.skills.find((s) => s.id === "everywhere")?.reason).toBe("all-phases");
  });

  it("lets a project disable a skill", () => {
    const overrides = { formatVersion: 1 as const, skills: { alpha: { enabled: false } } };
    expect(ids(resolvePhaseSkills(catalog, overrides, "build"))).toEqual(["beta", "everywhere"]);
  });

  it("lets a project re-enable a skill the catalog ships disabled", () => {
    const overrides = { formatVersion: 1 as const, skills: { dormant: { enabled: true } } };
    expect(ids(resolvePhaseSkills(catalog, overrides, "build"))).toContain("dormant");
  });

  it("lets a project move a skill to other phases", () => {
    const overrides = { formatVersion: 1 as const, skills: { gamma: { phases: ["build"] }, alpha: { phases: ["all"] } } };
    expect(ids(resolvePhaseSkills(catalog, overrides, "build"))).toEqual(["beta", "gamma", "alpha", "everywhere"]);
    expect(ids(resolvePhaseSkills(catalog, overrides, "prd"))).toEqual(["alpha", "everywhere"]);
  });

  it("warns about overrides for skills that are not in the catalog", () => {
    const overrides = { formatVersion: 1 as const, skills: { "no-such-skill": { enabled: false } } };
    const result = resolvePhaseSkills(catalog, overrides, "build");
    expect(result.warnings.join(" ")).toMatch(/no-such-skill/);
    expect(ids(result)).toEqual(["alpha", "beta", "everywhere"]);
  });

  it("warns about a phase that no skill is mapped to", () => {
    const result = resolvePhaseSkills(catalog, null, "made-up-phase");
    expect(ids(result)).toEqual(["everywhere"]);
    expect(result.warnings.join(" ")).toMatch(/made-up-phase/);
  });
});

describe("the real catalog", () => {
  const skillsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "skills");
  const source = createSkillDirectorySource(skillsDir);

  it("matches the skill-catalog schema", () => {
    const raw = JSON.parse(readFileSync(join(skillsDir, "catalog.json"), "utf8"));
    const result = validateMemoryFile("skill-catalog", raw);
    expect(result.ok, result.ok ? "" : JSON.stringify(result.issues.slice(0, 3))).toBe(true);
  });

  it("offers every phase some skills, and never the whole catalog", async () => {
    const loaded = await source.list();
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    for (const phase of new Set(Object.values(FLOWS).flat())) {
      const offered = resolvePhaseSkills(loaded.entries, null, phase).skills;
      expect(offered.length, phase).toBeGreaterThan(0);
      expect(offered.length, phase).toBeLessThan(loaded.entries.length);
    }
  });

  it("reads one skill's full text on request", async () => {
    const text = await source.readContent("solution-design");
    expect(text).toMatch(/^---\nname: solution-design/);
  });

  it("returns null for an unknown skill", async () => {
    expect(await source.readContent("no-such-skill")).toBeNull();
  });

  it("never reads a SKILL.md outside the skills folder, even when one exists there", async () => {
    // A real file sits next to the skills folder, so a traversal would succeed if allowed.
    const base = mkdtempSync(join(tmpdir(), "omni-skill-source-"));
    try {
      mkdirSync(join(base, "skills"));
      mkdirSync(join(base, "secret"));
      writeFileSync(join(base, "secret", "SKILL.md"), "outside the skills folder");
      const isolated = createSkillDirectorySource(join(base, "skills"));
      for (const bad of ["../secret", "..\\secret", "..", "/secret", "a/b", ""]) {
        expect(await isolated.readContent(bad), bad).toBeNull();
      }
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
