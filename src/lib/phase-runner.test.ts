// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore, PhaseEngine, type Invoke } from "@omni/core";
import { createNodeFs } from "@omni/core/node";
import { buildPhasePrompt, parsePhaseOutput, runPhase } from "./phase-runner";
import { createProjectFromIdea } from "./planning";
import { DESKTOP_PERSON } from "./decisions";
import { fakeInvoke, appStoreOptions } from "./testing/fake-invoke";
import type { Skill } from "./types";

// E5 slice 3: a planning phase runs with the person's own model, with that phase's skills, and
// is handed in for the person's review (PLAN-2, GATE-2, GATE-3, UND-1, SKL-8).

const node = createNodeFs();

function skill(id: string, phases: string[], content = `${id} skill body`): Skill {
  return {
    id,
    name: `${id} name`,
    description: `${id} description`,
    category: "strategy",
    attribution: { name: "Made-up Author", sourceUrl: "https://example.org", verified: true },
    enabled: true,
    content,
    isCustom: false,
    phases,
    license: "MIT",
  };
}

const SKILLS = [skill("idea-review", ["idea-review"]), skill("market-research", ["research"]), skill("doc-style", ["all"]), skill("security", ["build"])];

const answer = (doc: string, skills = "- idea-review: weighed the problem, users and alternatives") =>
  `${doc}\n\n## Understanding check\n\nThe person wants a shared shopping list for families.\n\n## Skills applied\n\n${skills}\n`;

describe("buildPhasePrompt", () => {
  const base = {
    phase: "research",
    projectName: "Orbit",
    idea: "A shared shopping list",
    skills: [{ id: "market-research", name: "Market research", content: "MARKET SKILL TEXT" }],
    earlier: [{ phase: "idea-review", text: "IDEA REVIEW DOC" }],
  };

  it("gives the model the phase's task, the idea, the skills' full text and the approved earlier documents", () => {
    const { prompt } = buildPhasePrompt(base);
    for (const part of ["research", "A shared shopping list", "MARKET SKILL TEXT", "IDEA REVIEW DOC", "## Understanding check", "## Skills applied", "market-research"]) {
      expect(prompt).toContain(part);
    }
  });

  it("includes the person's change notes and the version they reviewed", () => {
    const { prompt } = buildPhasePrompt({ ...base, notes: "Add competitors in India", previous: "OLD RESEARCH DOC" });
    expect(prompt).toContain("Add competitors in India");
    expect(prompt).toContain("OLD RESEARCH DOC");
  });

  it("drops the oldest earlier documents first when they are too long, and says so", () => {
    const earlier = [
      { phase: "idea-review", text: "A".repeat(50_000) },
      { phase: "research", text: "B".repeat(30_000) },
    ];
    const { prompt, trimmed } = buildPhasePrompt({ ...base, phase: "prd", earlier });
    expect(trimmed).toEqual(["idea-review"]);
    expect(prompt).not.toContain("A".repeat(50_000));
    expect(prompt).toContain("B".repeat(30_000));
    expect(prompt).toMatch(/left out.*idea-review/i);
  });
});

describe("parsePhaseOutput", () => {
  it("separates the document, the understanding check and the evidence per known skill", () => {
    const parsed = parsePhaseOutput(answer("# Idea review\n\nVerdict: worth building.", "- idea-review: weighed the problem\n- made-up-skill: not offered"), ["idea-review"]);
    expect(parsed).toEqual({
      ok: true,
      document: "# Idea review\n\nVerdict: worth building.",
      understanding: "The person wants a shared shopping list for families.",
      skillsUsed: [{ skill: "idea-review", evidence: "weighed the problem" }],
    });
  });

  it("refuses an answer without an understanding check", () => {
    const parsed = parsePhaseOutput("# Doc\n\n## Skills applied\n\n- idea-review: x", ["idea-review"]);
    expect(parsed).toMatchObject({ ok: false });
    if (!parsed.ok) expect(parsed.error).toMatch(/Understanding check/);
  });

  it("refuses an answer that names none of the skills it was given", () => {
    const parsed = parsePhaseOutput(answer("# Doc", "- something-else: x"), ["idea-review"]);
    expect(parsed).toMatchObject({ ok: false });
    if (!parsed.ok) expect(parsed.error).toMatch(/Skills applied/);
  });

  it("refuses an answer with no document before the sections", () => {
    expect(parsePhaseOutput(answer(""), ["idea-review"])).toMatchObject({ ok: false });
  });
});

describe("runPhase", () => {
  let base: string;
  let root: string;
  let prompts: string[];
  let reply: () => Promise<unknown>;

  const invoke: Invoke = (command, args) => {
    if (command === "byok_complete") {
      prompts.push((args.request as { prompt: string }).prompt);
      return reply();
    }
    return fakeInvoke()(command, args);
  };
  const byok = { ollamaEndpoint: "http://localhost:11434", preferredModel: "made-up-model" };
  const open = async () => {
    const opened = await MemoryStore.open(node, root, appStoreOptions());
    if (!opened.ok) throw new Error(JSON.stringify(opened.issues));
    return opened.store;
  };
  const ok = (text: string) => () => Promise.resolve({ text, provider: "ollama", model: "made-up-model" });

  beforeEach(async () => {
    base = mkdtempSync(join(tmpdir(), "omni-app-runner-")).replace(/\\/g, "/");
    const created = await createProjectFromIdea(fakeInvoke(), { parent: base, name: "Orbit", idea: "A shared shopping list" });
    if (!created.ok) throw new Error(created.error);
    root = created.root;
    prompts = [];
    reply = ok(answer("# Idea review\n\nVerdict: worth building."));
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it("runs the first planning phase and hands it in for review", async () => {
    const r = await runPhase(invoke, root, { byok, skills: SKILLS });
    expect(r).toMatchObject({ ok: true, phase: "idea-review", model: "made-up-model" });

    expect(prompts[0]).toContain("A shared shopping list");
    expect(prompts[0]).toContain("idea-review skill body");
    expect(prompts[0]).toContain("doc-style skill body");
    expect(prompts[0]).not.toContain("security skill body");

    expect(readFileSync(`${root}/docs/planning/idea-review.md`, "utf8")).toContain("Verdict: worth building.");
    expect(readFileSync(`${root}/docs/planning/idea-review-understanding.md`, "utf8")).toContain("shared shopping list for families");

    const store = await open();
    expect((await store.readState()).phases["idea-review"]?.status).toBe("awaiting_review");
    const events = (await store.readEvents()).events;
    const started = events.find((e) => e.type === "phase_started")!;
    expect(started.actor).toEqual({ kind: "agent", tool: "omni-desktop", model: "made-up-model" });
    const submitted = events.at(-1)!;
    expect(submitted.type).toBe("phase_submitted");
    expect(submitted.payload).toMatchObject({
      phase: "idea-review",
      documents: ["docs/planning/idea-review.md"],
      understandingCheck: "docs/planning/idea-review-understanding.md",
      skillsUsed: [{ skill: "idea-review", evidence: "weighed the problem, users and alternatives" }],
    });
  });

  it("writes nothing to memory when the provider fails, and returns its message", async () => {
    reply = () => Promise.reject("Ollama request failed: connection refused");
    const before = (await (await open()).readEvents()).events.length;
    const r = await runPhase(invoke, root, { byok, skills: SKILLS });
    expect(r).toEqual({ ok: false, error: "Ollama request failed: connection refused" });
    expect((await (await open()).readEvents()).events.length).toBe(before);
    expect(existsSync(`${root}/docs/planning/idea-review.md`)).toBe(false);
  });

  it("writes nothing when the model's answer is incomplete", async () => {
    reply = ok("# Idea review\n\nNo sections at all.");
    const before = (await (await open()).readEvents()).events.length;
    const r = await runPhase(invoke, root, { byok, skills: SKILLS });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/incomplete/i);
    expect((await (await open()).readEvents()).events.length).toBe(before);
  });

  it("will not run a phase that is waiting for the person's review", async () => {
    await runPhase(invoke, root, { byok, skills: SKILLS });
    const r = await runPhase(invoke, root, { byok, skills: SKILLS });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/waiting for your review/);
    expect(prompts).toHaveLength(1);
  });

  it("reruns with the person's notes after changes are requested", async () => {
    await runPhase(invoke, root, { byok, skills: SKILLS });
    await new PhaseEngine(await open()).requestChanges(DESKTOP_PERSON, "idea-review", "Compare with paper lists");
    reply = ok(answer("# Idea review v2"));
    const r = await runPhase(invoke, root, { byok, skills: SKILLS });
    expect(r).toMatchObject({ ok: true, phase: "idea-review" });
    expect(prompts[1]).toContain("Compare with paper lists");
    expect(prompts[1]).toContain("Verdict: worth building.");
    expect((await (await open()).readState()).phases["idea-review"]?.status).toBe("awaiting_review");
    expect(readFileSync(`${root}/docs/planning/idea-review.md`, "utf8")).toContain("v2");
  });

  it("gives the next phase the approved documents before it", async () => {
    await runPhase(invoke, root, { byok, skills: SKILLS });
    const store = await open();
    await new PhaseEngine(store).approve(DESKTOP_PERSON, "idea-review");
    await new PhaseEngine(store).start(DESKTOP_PERSON, "research");
    reply = ok(answer("# Research", "- market-research: listed three competitors"));
    const r = await runPhase(invoke, root, { byok, skills: SKILLS });
    expect(r).toMatchObject({ ok: true, phase: "research" });
    expect(prompts[1]).toContain("Verdict: worth building.");
    expect(prompts[1]).toContain("market-research skill body");
  });

  it("refuses to run a phase with no skills in the catalog", async () => {
    const r = await runPhase(invoke, root, { byok, skills: [skill("security", ["build"])] });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/no skills/i);
    expect(prompts).toHaveLength(0);
  });

  // E5 slice 4: architecture also needs a complete stack decision record (STK-1..3, C16).
  describe("architecture", () => {
    const ARCH_SKILLS = [...SKILLS, skill("prd-writing", ["prd"]), skill("stack-selection", ["architecture"])];
    const ADR = [
      "# Stack decision record",
      "## Status\n\nProposed",
      "## Context and constraints\n\nSmall team, web first.",
      "## Options considered\n\nA, B",
      "## Decision\n\nA is the best fit for these constraints.",
      "## Why the others lost\n\nB needs a server team.",
      "## Switch conditions\n\nMove to B past 10k users.",
      "## Sources\n\nhttps://example.org/docs",
    ];
    const archAnswer = (adr: string[]) =>
      answer(`# Architecture\n\nThree parts.\n\n${adr.join("\n\n")}`, "- stack-selection: compared two stacks against the constraints");

    async function throughPrd() {
      const replies: Record<string, string> = {
        "idea-review": answer("# Idea review"),
        research: answer("# Research", "- market-research: three competitors"),
        prd: answer("# PRD", "- prd-writing: requirements with ids"),
      };
      for (const phase of ["idea-review", "research", "prd"]) {
        reply = ok(replies[phase]);
        const r = await runPhase(invoke, root, { byok, skills: ARCH_SKILLS });
        if (!r.ok) throw new Error(r.error);
        const store = await open();
        await new PhaseEngine(store).approve(DESKTOP_PERSON, phase);
        const next = { "idea-review": "research", research: "prd", prd: "architecture" }[phase]!;
        await new PhaseEngine(store).start(DESKTOP_PERSON, next);
      }
    }

    it("asks for the stack decision record with every section the gate checks", () => {
      const { prompt } = buildPhasePrompt({ phase: "architecture", projectName: "Orbit", idea: "x", skills: [], earlier: [] });
      for (const part of ["# Stack decision record", "## Context and constraints", "## Why the others lost", "## Switch conditions", "## Sources", "best fit for these constraints"]) {
        expect(prompt).toContain(part);
      }
    });

    it("writes the record next to the architecture and hands both in", async () => {
      await throughPrd();
      reply = ok(archAnswer(ADR));
      const r = await runPhase(invoke, root, { byok, skills: ARCH_SKILLS });
      expect(r).toMatchObject({ ok: true, phase: "architecture" });
      expect(readFileSync(`${root}/docs/planning/architecture.md`, "utf8")).not.toContain("Stack decision record");
      expect(readFileSync(`${root}/docs/planning/architecture-stack-adr.md`, "utf8")).toContain("best fit for these constraints");
      const submitted = (await (await open()).readEvents()).events.at(-1)!;
      expect(submitted.payload).toMatchObject({ phase: "architecture", stackAdr: "docs/planning/architecture-stack-adr.md" });
    });

    it("records nothing when the record misses a section, and names it", async () => {
      await throughPrd();
      const before = (await (await open()).readEvents()).events.length;
      reply = ok(archAnswer(ADR.filter((s) => !s.startsWith("## Switch conditions"))));
      const r = await runPhase(invoke, root, { byok, skills: ARCH_SKILLS });
      expect(r).toMatchObject({ ok: false });
      if (!r.ok) expect(r.error).toMatch(/Switch conditions/);
      expect((await (await open()).readEvents()).events.length).toBe(before);
      expect(existsSync(`${root}/docs/planning/architecture-stack-adr.md`)).toBe(false);
    });

    it("records nothing when there is no record at all", async () => {
      await throughPrd();
      const before = (await (await open()).readEvents()).events.length;
      reply = ok(answer("# Architecture\n\nNo record.", "- stack-selection: x"));
      const r = await runPhase(invoke, root, { byok, skills: ARCH_SKILLS });
      expect(r).toMatchObject({ ok: false });
      if (!r.ok) expect(r.error).toMatch(/stack decision record/i);
      expect((await (await open()).readEvents()).events.length).toBe(before);
      expect(existsSync(`${root}/docs/planning/architecture.md`)).toBe(false);
    });
  });
});
