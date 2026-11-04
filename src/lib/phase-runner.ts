/**
 * Runs one planning phase with the person's own model (E5, PLAN-1, PLAN-2). The phase's skills
 * come from the catalog with the project's skills.json overrides (the same resolver the MCP
 * server uses); the model's answer must carry an Understanding check (UND-1) and per-skill
 * evidence (SKL-8), or nothing is recorded. Starting, the memory update (GATE-3) and the
 * hand-in all go through @omni/core's PhaseEngine, so the person reviews it exactly as they
 * would a phase done in an IDE. Model output is untrusted text: it is only ever written to
 * Markdown files and parsed for its sections, never executed or rendered as HTML.
 */
import {
  checkStackAdr,
  createInvokeFs,
  FLOWS,
  MemoryStore,
  normalizePath,
  PhaseEngine,
  PLANNING_PHASES,
  resolvePhaseSkills,
  STACK_ADR_PHASES,
  STACK_ADR_SECTIONS,
  validateMemoryFile,
  type CatalogEntry,
  type Event,
  type Invoke,
  type MemoryStore as Store, desktopStoreOptions } from "@omni/core";
import type { BYOKConfig, Skill } from "./types";

/** What each planning phase asks the model to write (the skills give the method). */
const PHASE_TASKS: Record<string, string> = {
  "idea-review":
    "Review the idea honestly: the problem and who has it, how people solve it today, what would make this worth building, the main risks, and a clear verdict (build, change, or drop) with reasons.",
  research:
    "Research the idea's market and technology: existing products and how they compare, the users and their needs, technical options and constraints, and the open questions the PRD must settle.",
  prd: "Write the product requirements document: objective, users, scope and non-goals, requirements with ids (REQ-1, REQ-2, ...) each with a priority and testable acceptance criteria, and open questions.",
  architecture:
    "Design the architecture: components and their responsibilities, data model, interfaces between parts, how the requirements are met (by id), security and privacy, testing approach, and risks.",
};

/** Characters of earlier documents, and of skill text, sent with one prompt. */
const EARLIER_BUDGET = 60_000;
const SKILL_BUDGET = 60_000;

export const PLANNING_AGENT_TOOL = "omni-desktop";

/** The title line that starts the stack decision record inside the model's answer. */
const ADR_TITLE = "# Stack decision record";

const needsStackAdr = (phase: string) => (STACK_ADR_PHASES as readonly string[]).includes(phase);

/** STK-1..3 (C16): what the record must contain, in the order the stack-selection skill writes it. */
const ADR_RULES = [
  `- After the document (before the two sections below), write the stack decision record. Start it with the line "${ADR_TITLE}", then these sections, in this order and with exactly these headings: ${STACK_ADR_SECTIONS.map((name) => `"## ${name}"`).join(", ")}.`,
  '- In "## Decision", call the chosen stack "the best fit for these constraints", never the best in general.',
  '- In "## Sources", list the official documentation you relied on as https links; they will be checked, so mark any you are unsure of "to verify".',
];

const reason = (error: unknown) => (error instanceof Error ? error.message : typeof error === "string" ? error : String(error));

export interface PromptInput {
  phase: string;
  projectName: string;
  idea: string;
  skills: { id: string; name: string; content: string }[];
  /** Approved documents of earlier phases, oldest first. */
  earlier: { phase: string; text: string }[];
  /** The person's change notes, and the version they reviewed. */
  notes?: string;
  previous?: string;
}

export function buildPhasePrompt(input: PromptInput): { prompt: string; trimmed: string[] } {
  // Newest earlier documents matter most: keep from the newest back while they fit.
  const kept: { phase: string; text: string }[] = [];
  const trimmed: string[] = [];
  let used = 0;
  for (const doc of [...input.earlier].reverse()) {
    if (used + doc.text.length <= EARLIER_BUDGET) {
      kept.unshift(doc);
      used += doc.text.length;
    } else trimmed.unshift(doc.phase);
  }

  let skillChars = 0;
  const skillText = input.skills.map((s) => {
    const fits = skillChars + s.content.length <= SKILL_BUDGET;
    if (fits) skillChars += s.content.length;
    return `### ${s.id}: ${s.name}\n\n${fits ? s.content : "(Full text left out for length; follow what its name says.)"}`;
  });

  const ids = input.skills.map((s) => s.id).join(", ");
  const parts = [
    `You are the planning agent for the project "${input.projectName}", working on its "${input.phase}" phase. A person reviews your work and approves it or asks for changes.`,
    `## Your task\n\n${PHASE_TASKS[input.phase] ?? `Write the "${input.phase}" document.`}`,
    [
      "## Rules",
      "",
      "- Work only from the idea and documents below. You cannot browse the web: when a fact needs checking (a price, a competitor, a number), say so and mark it \"to verify\".",
      "- Follow the skills below: they are the method for this phase.",
      "- Write the document in Markdown, starting with a \"# \" title.",
      "- After the document, add exactly these two sections:",
      "  - \"## Understanding check\": in a few sentences, what you understood the person wants, and any assumption you made.",
      `  - "## Skills applied": one line per skill you followed, as "- <skill id>: what you did with it". Use only these ids: ${ids}.`,
      ...(needsStackAdr(input.phase) ? ADR_RULES : []),
    ].join("\n"),
    `## The idea\n\n${input.idea}`,
  ];
  if (kept.length > 0 || trimmed.length > 0) {
    const docs = kept.map((d) => `### ${d.phase}\n\n${d.text}`);
    if (trimmed.length > 0) docs.push(`(Left out for length: ${trimmed.join(", ")}.)`);
    parts.push(`## Approved earlier documents\n\n${docs.join("\n\n")}`);
  }
  parts.push(`## Skills for this phase\n\n${skillText.join("\n\n")}`);
  if (input.notes) {
    parts.push(`## Changes the person asked for\n\n${input.notes}`);
    if (input.previous) parts.push(`## The version they reviewed\n\n${input.previous}`);
  }
  return { prompt: parts.join("\n\n"), trimmed };
}

export type ParsedOutput =
  | { ok: true; document: string; understanding: string; skillsUsed: { skill: string; evidence: string }[] }
  | { ok: false; error: string };

const incomplete = (what: string): ParsedOutput => ({
  ok: false,
  error: `The model's answer was incomplete: ${what}. Run the phase again, or choose a stronger model in Settings.`,
});

/** The body of the last "## <heading>" section, and where that heading starts. */
function section(text: string, heading: string): { start: number; body: string } | null {
  const pattern = new RegExp(`^## ${heading}[ \\t]*$`, "gim");
  let match: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;
  while ((match = pattern.exec(text)) !== null) last = match;
  if (!last) return null;
  const after = text.slice(last.index + last[0].length);
  const next = after.search(/^## /m);
  return { start: last.index, body: (next === -1 ? after : after.slice(0, next)).trim() };
}

export function parsePhaseOutput(text: string, skillIds: string[]): ParsedOutput {
  const understanding = section(text, "Understanding check");
  const applied = section(text, "Skills applied");
  if (!understanding || !understanding.body) return incomplete('it has no "## Understanding check" section');
  if (!applied) return incomplete('it has no "## Skills applied" section');

  const known = new Set(skillIds);
  const skillsUsed: { skill: string; evidence: string }[] = [];
  for (const line of applied.body.split(/\r?\n/)) {
    const m = line.match(/^\s*[-*]\s*`?([a-z0-9][a-z0-9-]*)`?\s*:\s*(.+?)\s*$/);
    if (m && known.has(m[1]) && !skillsUsed.some((s) => s.skill === m[1])) skillsUsed.push({ skill: m[1], evidence: m[2] });
  }
  if (skillsUsed.length === 0) return incomplete('its "## Skills applied" section names none of the skills it was given');

  const document = text.slice(0, Math.min(understanding.start, applied.start)).trim();
  if (!document) return incomplete("it has no document before its sections");
  return { ok: true, document, understanding: understanding.body, skillsUsed };
}

type Failure = { ok: false; error: string };

/** Separates the stack decision record from the architecture document and checks it (C16). */
export function splitStackAdr(document: string): { ok: true; document: string; adr: string } | Failure {
  const lines = document.split(/\r?\n/);
  const at = lines.findIndex((line) => line.trim().toLowerCase() === ADR_TITLE.toLowerCase());
  if (at === -1) return incomplete(`it has no stack decision record (a "${ADR_TITLE}" part after the document)`) as Failure;
  const adr = lines.slice(at).join("\n").trim();
  const problems = checkStackAdr(adr);
  if (problems.length > 0) return incomplete(`its stack decision record is not complete (${problems.join("; ")})`) as Failure;
  const before = lines.slice(0, at).join("\n").trim();
  if (!before) return incomplete("it has no architecture document before the stack decision record") as Failure;
  return { ok: true, document: before, adr };
}

export type RunResult =
  | { ok: true; phase: string; provider: string; model: string; trimmed: string[]; message: string }
  | { ok: false; error: string };

/** The planning phase to work on now, if the next phase is one. */
function currentPhase(store: Store, state: Awaited<ReturnType<Store["readState"]>>): string | null {
  const order = (FLOWS as Record<string, readonly string[]>)[store.readProject().flow] ?? [];
  const next = order.find((p) => !["approved", "skipped"].includes(state.phases[p]?.status ?? "not_started"));
  return next && (PLANNING_PHASES as readonly string[]).includes(next) ? next : null;
}

/** The phase's skills with full text: catalog plus the project's skills.json overrides. */
export async function phaseSkills(store: Store, skills: Skill[], phase: string) {
  const catalog = skills.map((s) => ({ ...s, license: s.license ?? "unverified", phases: s.phases ?? [], domains: ["general"] })) as unknown as CatalogEntry[];
  let overrides = null;
  const raw = await store.readFile("skills.json");
  if (raw !== null) {
    try {
      const valid = validateMemoryFile("skills-config", JSON.parse(raw));
      if (valid.ok) overrides = valid.value;
    } catch {
      // An unreadable skills.json falls back to the catalog's defaults, as in the MCP server.
    }
  }
  const byId = new Map(skills.map((s) => [s.id, s]));
  return resolvePhaseSkills(catalog, overrides, phase).skills.map((s) => ({ id: s.id, name: s.name, content: byId.get(s.id)?.content ?? s.description }));
}

export const readDoc = async (invoke: Invoke, root: string, name: string) => (await invoke("read_planning_document", { root, name })) as string | null;

function lastNotes(events: Event[], phase: string): string | undefined {
  const request = [...events].reverse().find((e) => e.type === "changes_requested" && (e.payload as { phase?: string }).phase === phase);
  return (request?.payload as { notes?: string } | undefined)?.notes;
}

export async function runPhase(invoke: Invoke, rootIn: string, options: { byok: BYOKConfig; skills: Skill[] }): Promise<RunResult> {
  const root = normalizePath(rootIn);
  try {
    const opened = await MemoryStore.open(createInvokeFs(invoke), root, desktopStoreOptions(invoke));
    if (!opened.ok) return { ok: false, error: opened.issues.map((i) => `${i.path} ${i.message}`.trim()).join("; ") };
    const store = opened.store;
    const state = await store.readState();
    const phase = currentPhase(store, state);
    if (!phase) return { ok: false, error: "There is no planning phase to run: planning is done, or the next phase is not a planning phase." };
    const status = state.phases[phase]?.status ?? "not_started";
    if (status === "awaiting_review") return { ok: false, error: `"${phase}" is waiting for your review: approve it or request changes first.` };

    const skills = await phaseSkills(store, options.skills, phase);
    if (skills.length === 0) return { ok: false, error: `There are no skills for "${phase}" in the skill catalog; enable one in Skills first.` };

    const events = (await store.readEvents()).events;
    const order = (FLOWS as Record<string, readonly string[]>)[store.readProject().flow] ?? [];
    const earlier: { phase: string; text: string }[] = [];
    for (const p of order.slice(0, order.indexOf(phase))) {
      if (state.phases[p]?.status !== "approved") continue;
      const text = await readDoc(invoke, root, `${p}.md`);
      if (text) earlier.push({ phase: p, text });
    }
    const notes = status === "changes_requested" ? lastNotes(events, phase) : undefined;
    const { prompt, trimmed } = buildPhasePrompt({
      phase,
      projectName: store.readProject().name,
      idea: (await readDoc(invoke, root, "idea.md")) ?? "(The idea file docs/planning/idea.md is missing.)",
      skills,
      earlier,
      ...(notes ? { notes, previous: (await readDoc(invoke, root, `${phase}.md`)) ?? undefined } : {}),
    });

    const reply = (await invoke("byok_complete", { request: { prompt, byok: options.byok } })) as { text: string; provider: string; model: string };
    const parsed = parsePhaseOutput(reply.text, skills.map((s) => s.id));
    if (!parsed.ok) return parsed;
    const split = needsStackAdr(phase) ? splitStackAdr(parsed.document) : { ok: true as const, document: parsed.document, adr: null };
    if (!split.ok) return split;

    const agent = { kind: "agent" as const, tool: PLANNING_AGENT_TOOL, model: reply.model.slice(0, 200) };
    const engine = new PhaseEngine(store);
    if (status === "not_started") {
      const started = await engine.start(agent, phase);
      if (!started.ok) return { ok: false, error: started.issues.map((i) => i.message).join("; ") };
    }
    const documentPath = `docs/planning/${phase}.md`;
    const understandingPath = `docs/planning/${phase}-understanding.md`;
    const adrPath = `docs/planning/${phase}-stack-adr.md`;
    await invoke("write_planning_document", { root, name: `${phase}.md`, content: `${split.document}\n` });
    if (split.adr) await invoke("write_planning_document", { root, name: `${phase}-stack-adr.md`, content: `${split.adr}\n` });
    await invoke("write_planning_document", { root, name: `${phase}-understanding.md`, content: `# ${phase}: understanding check\n\n${parsed.understanding}\n` });
    const updated = await store.appendEvent({ type: "memory_updated", actor: agent, payload: { files: [documentPath, understandingPath, ...(split.adr ? [adrPath] : [])] } });
    if (!updated.ok) return { ok: false, error: updated.issues.map((i) => i.message).join("; ") };
    const submitted = await engine.submit(agent, { phase, documents: [documentPath], skillsUsed: parsed.skillsUsed, understandingCheck: understandingPath, ...(split.adr ? { stackAdr: adrPath } : {}) });
    if (!submitted.ok) return { ok: false, error: submitted.issues.map((i) => i.message).join("; ") };
    return {
      ok: true,
      phase,
      provider: reply.provider,
      model: reply.model,
      trimmed,
      message: `"${phase}" is ready for your review (written by ${reply.model}). Read ${documentPath}, then approve it or request changes.`,
    };
  } catch (error) {
    return { ok: false, error: reason(error) };
  }
}
