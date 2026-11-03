import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateMemoryFile, SCHEMA_NAMES, PHASE_IDS } from "./index.js";
import { generateContract } from "../scripts/generate-contract.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "..", "..", "schemas", "fixtures");
const fixture = (schema: string, kind: string, file: string) =>
  JSON.parse(readFileSync(join(fixturesDir, schema, kind, file), "utf8"));

describe("validateMemoryFile: generated validators match every fixture", () => {
  for (const name of readdirSync(fixturesDir)) {
    for (const kind of ["valid", "invalid"] as const) {
      for (const file of readdirSync(join(fixturesDir, name, kind))) {
        it(`${name} ${kind}: ${file}`, () => {
          const result = validateMemoryFile(name as (typeof SCHEMA_NAMES)[number], fixture(name, kind, file));
          expect(result.ok, result.ok ? "" : JSON.stringify(result.issues)).toBe(kind === "valid");
        });
      }
    }
  }
});

describe("validateMemoryFile: error shape", () => {
  it("returns issues with a JSON path and message instead of throwing", () => {
    const result = validateMemoryFile("project", { formatVersion: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.length).toBeGreaterThan(0);
    for (const issue of result.issues) {
      expect(typeof issue.path).toBe("string");
      expect(issue.message.length).toBeGreaterThan(0);
    }
  });

  it("returns the typed value on success", () => {
    const data = fixture("project", "valid", "basic-build-project.json");
    const result = validateMemoryFile("project", data);
    expect(result.ok && result.value.name).toBe("Clinic scheduler");
  });
});

describe("validateMemoryFile: rules the schemas cannot express", () => {
  it("rejects a state whose current phase is not a known phase", () => {
    const state = { ...fixture("state", "valid", "build-in-progress.json"), currentPhase: "made-up-phase" };
    const result = validateMemoryFile("state", state);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues.some((i) => i.path === "/currentPhase" && /unknown phase/.test(i.message))).toBe(true);
  });

  it("rejects state phase keys that are not known phases", () => {
    const base = fixture("state", "valid", "build-in-progress.json");
    const result = validateMemoryFile("state", { ...base, phases: { ...base.phases, "made-up-phase": { status: "in_progress" } } });
    expect(result.ok).toBe(false);
  });

  it("rejects an event whose payload names an unknown phase", () => {
    const event = fixture("event", "valid", "phase-approved-by-human.json");
    const result = validateMemoryFile("event", { ...event, payload: { phase: "made-up-phase" } });
    expect(!result.ok && result.issues.some((i) => i.path === "/payload/phase")).toBe(true);
  });

  it("rejects skill overrides mapped to unknown phases but accepts all", () => {
    const bad = { formatVersion: 1, skills: { x: { phases: ["made-up-phase"] } } };
    const good = { formatVersion: 1, skills: { x: { phases: ["all"] } } };
    expect(validateMemoryFile("skills-config", bad).ok).toBe(false);
    expect(validateMemoryFile("skills-config", good).ok).toBe(true);
  });

  it("rejects a team that lists the same tool twice", () => {
    const team = fixture("team", "valid", "two-members.json");
    const twice = { ...team, members: [team.members[0], { ...team.members[0], capability: 2 }] };
    const result = validateMemoryFile("team", twice);
    expect(!result.ok && result.issues.some((i) => i.path === "/members/1/toolId")).toBe(true);
    expect(validateMemoryFile("team", team).ok).toBe(true);
  });

  it("rejects a design note whose chosen approach is not one of its approaches", () => {
    const note = { ...fixture("design-note", "valid", "two-approaches.json"), chosen: "not-listed" };
    const result = validateMemoryFile("design-note", note);
    expect(!result.ok && result.issues.some((i) => i.path === "/chosen")).toBe(true);
  });

  it("exposes every phase id from schemas/phases.json", () => {
    const phasesFile = JSON.parse(readFileSync(join(fixturesDir, "..", "phases.json"), "utf8"));
    const all = new Set(Object.values(phasesFile.flows as Record<string, string[]>).flat());
    expect(new Set(PHASE_IDS)).toEqual(all);
  });
});

describe("generated contract files", () => {
  it("are up to date with the schemas (run `npm run generate -w @omni/core` if this fails)", async () => {
    const expected = await generateContract();
    for (const [relPath, content] of Object.entries(expected)) {
      const actual = readFileSync(join(here, "..", relPath), "utf8").replace(/\r\n/g, "\n");
      expect(actual, `${relPath} is stale`).toBe(content);
    }
  });
});
