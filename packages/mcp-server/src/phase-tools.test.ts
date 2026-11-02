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

// --- submit_phase (GATE-3, UND-1, SKL-4). Every rejection must leave the memory untouched.

import { mkdirSync, writeFileSync } from "node:fs";
import { submitPhase, type SubmitInput } from "./phase-tools.js";

const tool = { kind: "agent" as const, tool: "made-up-client" };

function write(rel: string, text = "content\n") {
  mkdirSync(join(root, rel, ".."), { recursive: true });
  writeFileSync(join(root, rel), text);
}
const eventTypes = async () => (await store.readEvents()).events.map((e) => e.type);

/** A complete, valid submission of the planning phase "idea-review". */
async function ready(): Promise<SubmitInput> {
  await startPhase("idea-review");
  write("docs/idea-review.md");
  write("docs/understanding.md", "Restated request; examples mapped to categories; assumptions.\n");
  return {
    phase: "idea-review",
    documents: ["docs/idea-review.md"],
    skillsUsed: [{ skill: "plan-well", evidence: "Compared three approaches in docs/idea-review.md" }],
    understandingCheck: "docs/understanding.md",
    memoryUpdate: { files: ["docs/idea-review.md"] },
  };
}
const submit = (input: SubmitInput) => submitPhase({ fs, skills, startDir: root }, tool, input);

describe("submit_phase", () => {
  it("records the memory update and the submission, and asks for the person's review", async () => {
    const result = await submit(await ready());
    if (!result.ok) throw new Error(result.message);
    expect(result.value).toMatchObject({ phase: "idea-review", status: "awaiting_review" });
    expect(result.value.reviewQuestion).toMatch(/reviewed/);
    expect((await eventTypes()).slice(-2)).toEqual(["memory_updated", "phase_submitted"]);
    const submitted = (await store.readEvents()).events.at(-1)!;
    expect(submitted.actor).toEqual(tool);
    expect(submitted.id).toBe(result.value.eventId);
    expect((await store.readState()).phases["idea-review"].status).toBe("awaiting_review");
  });

  it("accepts a memory update recorded earlier in the phase", async () => {
    const input = await ready();
    const earlier = await store.appendEvent({ type: "memory_updated", actor: tool, payload: { files: ["docs/idea-review.md"] } });
    if (!earlier.ok) throw new Error(JSON.stringify(earlier));
    const { memoryUpdate: _, ...withoutUpdate } = input;
    expect((await submit(withoutUpdate)).ok).toBe(true);
  });

  it("rejects a submission without a memory update and writes nothing", async () => {
    const { memoryUpdate: _, ...input } = await ready();
    const before = await eventTypes();
    const result = await submit(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/update the project memory/);
    expect(await eventTypes()).toEqual(before);
  });

  it("rejects a planning phase without an understanding check and writes nothing", async () => {
    const { understandingCheck: _, ...input } = await ready();
    const before = await eventTypes();
    const result = await submit(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/Understanding check/);
    expect(await eventTypes()).toEqual(before);
  });

  it("checks every referenced file before anything is written", async () => {
    const input = await ready();
    const before = await eventTypes();
    const result = await submit({
      ...input,
      documents: ["docs/idea-review.md", "docs/not-written.md", "../outside.md"],
      memoryUpdate: { files: ["/etc/passwd"] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/docs\/not-written\.md: missing/);
      expect(result.message).toMatch(/\.\.\/outside\.md: invalid/);
      expect(result.message).toMatch(/\/etc\/passwd: invalid/);
    }
    expect(await eventTypes()).toEqual(before);
  });

  it("rejects a missing or blank understanding check", async () => {
    const input = await ready();
    write("docs/blank.md", "  \n\n");
    for (const understandingCheck of ["docs/nowhere.md", "docs/blank.md"]) {
      const result = await submit({ ...input, understandingCheck });
      expect(result.ok, understandingCheck).toBe(false);
    }
    expect(await eventTypes()).not.toContain("phase_submitted");
  });

  it("rejects a phase that has not started, and a second submission", async () => {
    write("docs/a.md");
    const early = await submit({
      phase: "research",
      documents: ["docs/a.md"],
      skillsUsed: [{ skill: "plan-well", evidence: "x" }],
      memoryUpdate: { files: ["docs/a.md"] },
    });
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.message).toMatch(/has not been started/);

    const input = await ready();
    expect((await submit(input)).ok).toBe(true);
    const again = await submit(input);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.message).toMatch(/awaiting_review/);
  });
});

// --- C16 (STK-1..3): the architecture submission must reference a complete stack ADR.

const stackAdr = `# ADR-001: Stack for the planner

## Status
Proposed

## Context and constraints
Hard filters: runs on Windows and macOS; the user knows TypeScript.

## Options considered
| Criterion | A | B |
|---|---|---|
| Desktop | yes | yes |

## Decision
A is the best fit for these constraints.

## Why the others lost
- B: needs a runtime the user does not know.

## Switch conditions
- If mobile becomes a target, B wins.

## Sources
- https://example.org/a
`;

/** A complete, valid submission of the architecture phase. */
async function readyArchitecture(): Promise<SubmitInput> {
  await startPhase("architecture");
  write("docs/ARCHITECTURE.md");
  write("docs/understanding.md", "Restated request; constraints confirmed by the user.\n");
  write("docs/decisions/ADR-001-stack.md", stackAdr);
  return {
    phase: "architecture",
    documents: ["docs/ARCHITECTURE.md"],
    skillsUsed: [{ skill: "plan-well", evidence: "Stack compared in docs/decisions/ADR-001-stack.md" }],
    understandingCheck: "docs/understanding.md",
    stackAdr: "docs/decisions/ADR-001-stack.md",
    memoryUpdate: { files: ["docs/ARCHITECTURE.md"] },
  };
}

describe("submit_phase for the architecture phase (C16)", () => {
  it("accepts a submission that references a complete stack ADR and records it", async () => {
    const result = await submit(await readyArchitecture());
    if (!result.ok) throw new Error(result.message);
    expect((await store.readEvents()).events.at(-1)!.payload).toMatchObject({ stackAdr: "docs/decisions/ADR-001-stack.md" });
  });

  it("accepts an ADR saved with Windows line endings", async () => {
    const input = await readyArchitecture();
    write("docs/decisions/ADR-001-stack.md", stackAdr.replace(/\n/g, "\r\n"));
    expect((await submit(input)).ok).toBe(true);
  });

  it("rejects a submission without the ADR, says how to fix it, and writes nothing", async () => {
    const { stackAdr: _, ...input } = await readyArchitecture();
    const before = await eventTypes();
    const result = await submit(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/"architecture" needs a stack decision record: include the ADR \(stackAdr\)/);
    expect(await eventTypes()).toEqual(before);
  });

  it("names every missing section of an incomplete ADR and writes nothing", async () => {
    const input = await readyArchitecture();
    write("docs/decisions/ADR-001-stack.md", stackAdr.replace(/## Switch conditions[\s\S]*?(?=## Sources)/, "").replace("## Status\nProposed\n", ""));
    const before = await eventTypes();
    const result = await submit(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe(
        "docs/decisions/ADR-001-stack.md is not a complete stack ADR: missing section: Status; missing section: Switch conditions. " +
          "Finish it with the stack-selection skill, then submit again.",
      );
    }
    expect(await eventTypes()).toEqual(before);
  });

  it("rejects an ADR that is missing, empty, or outside the project", async () => {
    const input = await readyArchitecture();
    write("docs/decisions/empty.md", "");
    const cases: [string, RegExp][] = [
      ["docs/decisions/nowhere.md", /docs\/decisions\/nowhere\.md: missing/],
      ["../outside/ADR-001.md", /\.\.\/outside\/ADR-001\.md: invalid/],
      ["docs/decisions/empty.md", /docs\/decisions\/empty\.md is not a complete stack ADR: missing section: Status/],
    ];
    for (const [path, message] of cases) {
      const result = await submit({ ...input, stackAdr: path });
      expect(result.ok, path).toBe(false);
      if (!result.ok) expect(result.message).toMatch(message);
    }
    expect(await eventTypes()).not.toContain("phase_submitted");
  });

  it("checks an ADR given with another phase too, so a referenced ADR is never broken", async () => {
    const input = await ready();
    write("docs/decisions/half.md", "## Status\nProposed\n");
    const result = await submit({ ...input, stackAdr: "docs/decisions/half.md" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/not a complete stack ADR/);
  });
});
