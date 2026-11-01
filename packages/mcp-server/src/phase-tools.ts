/** Phase tools (ARCHITECTURE 5; SKL-2, SKL-3, GATE-3, UND-1). There is deliberately no approve tool. */
import {
  checkPhaseAction,
  checkRefs,
  FLOWS,
  joinPath,
  PhaseEngine,
  PLANNING_PHASES,
  type Event,
  type ResolvedSkill,
} from "@omni/core";
import { currentSkills, openProject, type ToolDeps } from "./project.js";

export type ToolResult<T> = { ok: true; value: T } | { ok: false; message: string };

export interface PhaseSkills {
  phase: string;
  skills: (Pick<ResolvedSkill, "id" | "name" | "reason" | "license"> & { content: string })[];
  warnings: string[];
}

/** Full text of the current phase's skills (never the whole catalog); `ids` narrows the set. */
export async function getPhaseSkills(
  deps: ToolDeps,
  input: { projectPath?: string; ids?: string[] },
): Promise<ToolResult<PhaseSkills>> {
  const opened = await openProject(deps, input.projectPath);
  if (!opened.ok) return opened;
  const phase = (await opened.store.readState()).currentPhase;
  if (phase === null) {
    return { ok: false, message: "No phase has started yet. Ask the user to start the first phase in the OmniOrchestrator app." };
  }
  const warnings: string[] = [];
  const resolved = await currentSkills(deps.skills, opened.store, phase, warnings);
  const allowed = resolved.map((s) => s.id);
  const outside = (input.ids ?? []).filter((id) => !allowed.includes(id));
  if (outside.length > 0) {
    return {
      ok: false,
      message: `${outside.join(", ")} ${outside.length === 1 ? "is" : "are"} not a skill of the "${phase}" phase. Its skills are: ${allowed.join(", ") || "none"}.`,
    };
  }
  const wanted = input.ids ? resolved.filter((s) => input.ids!.includes(s.id)) : resolved;
  const skills: PhaseSkills["skills"] = [];
  for (const skill of wanted) {
    const content = await deps.skills.readContent(skill.id);
    if (content === null) {
      warnings.push(`The text of skill "${skill.id}" could not be read; it was left out.`);
      continue;
    }
    skills.push({ id: skill.id, name: skill.name, reason: skill.reason, license: skill.license, content });
  }
  return { ok: true, value: { phase, skills, warnings } };
}

export interface SubmitInput {
  projectPath?: string;
  phase: string;
  /** Project-relative documents produced in this phase. */
  documents: string[];
  /** Each skill followed, with evidence (SKL-4, SKL-8). */
  skillsUsed: { skill: string; evidence: string }[];
  /** Project-relative file with the confirmed Understanding check (planning phases, UND-1). */
  understandingCheck?: string;
  /** Memory files updated for this phase; recorded as memory_updated before the submission (GATE-3). */
  memoryUpdate?: { files: string[] };
}

export interface Submitted {
  phase: string;
  status: "awaiting_review";
  eventId: string;
  /** Show this to the user with the documents (GATE-2). */
  reviewQuestion: string;
  warning?: string;
}

const messages = (issues: { path: string; message: string }[]) => issues.map((i) => i.message).join("; ");

/**
 * Hands a phase in for a person's review. Everything is checked first (files with checkRefs, the
 * understanding check's text, the phase rules including the would-be memory update), so a
 * rejected submission writes nothing. PhaseEngine re-checks atomically under the lock.
 */
export async function submitPhase(deps: ToolDeps, actor: Event["actor"], input: SubmitInput): Promise<ToolResult<Submitted>> {
  const opened = await openProject(deps, input.projectPath);
  if (!opened.ok) return opened;
  const { store, root } = opened;

  const files = [...input.documents, ...(input.understandingCheck ? [input.understandingCheck] : []), ...(input.memoryUpdate?.files ?? [])];
  const refs = await checkRefs(deps.fs, root, { files: [...new Set(files)] });
  const bad = refs.results.filter((r) => r.status !== "ok");
  if (bad.length > 0) {
    return {
      ok: false,
      message: `Fix these files before submitting: ${bad.map((r) => `${r.ref}: ${r.status}${r.message ? ` (${r.message})` : ""}`).join("; ")}.`,
    };
  }
  if (input.understandingCheck) {
    const text = await deps.fs.readText(joinPath(root, input.understandingCheck));
    if (!text || text.trim() === "") {
      return { ok: false, message: `${input.understandingCheck} is empty: write the Understanding check and have the user confirm it.` };
    }
  }

  const submission = {
    phase: input.phase,
    documents: input.documents,
    skillsUsed: input.skillsUsed,
    ...(input.understandingCheck ? { understandingCheck: input.understandingCheck } : {}),
  };
  const state = await store.readState();
  const { events } = await store.readEvents();
  // Check the phase rules as if the memory update were already recorded, so nothing is written
  // when the submission would be rejected anyway.
  const wouldBe = input.memoryUpdate
    ? [...events, { type: "memory_updated", actor, payload: { files: input.memoryUpdate.files } } as unknown as Event]
    : events;
  const rules = checkPhaseAction(
    { state, events: wouldBe, flow: state.flow, flows: FLOWS, planning: PLANNING_PHASES },
    { kind: "submit", ...submission },
    actor,
  );
  if (!rules.ok) return { ok: false, message: messages(rules.issues) };

  if (input.memoryUpdate) {
    const recorded = await store.appendEvent({ type: "memory_updated", actor, payload: { files: input.memoryUpdate.files } });
    if (!recorded.ok) return { ok: false, message: messages(recorded.issues) };
  }
  const result = await new PhaseEngine(store).submit(actor, submission);
  if (!result.ok) return { ok: false, message: messages(result.issues) };
  return {
    ok: true,
    value: {
      phase: input.phase,
      status: "awaiting_review",
      eventId: result.event.id,
      reviewQuestion: result.reviewQuestion ?? "",
      ...(result.warning ? { warning: result.warning } : {}),
    },
  };
}
