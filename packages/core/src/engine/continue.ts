import { OPTIONAL_PHASES } from "../generated/contract.js";
import type { Event } from "../generated/types.js";
import type { MemoryStore } from "../memory/store.js";
import type { ValidationIssue } from "../validate.js";
import { nextPhase, PhaseEngine } from "./phases.js";

type Actor = Event["actor"];

export type ContinueResult =
  | { kind: "started"; phase: string }
  /** An optional phase is next: ask the person (SEC-1). Nothing was written. */
  | { kind: "needs_decision"; phase: string; question: string }
  /** The next phase is already under way (or awaiting review). Nothing was written. */
  | { kind: "in_progress"; phase: string }
  | { kind: "done" }
  | { kind: "start_failed"; phase: string; issues: ValidationIssue[] };

/**
 * After a person approves or skips a phase: starts the next phase as that person, except an
 * optional one, which only the person decides (approving one phase is not consent to the next).
 * Shared by the extension and the desktop app so both behave the same.
 */
export async function continueAfterDecision(store: MemoryStore, person: Actor): Promise<ContinueResult> {
  const state = await store.readState();
  const next = nextPhase(store.readProject().flow, state);
  if (next === null) return { kind: "done" };
  if ((state.phases[next]?.status ?? "not_started") !== "not_started") return { kind: "in_progress", phase: next };
  const question = OPTIONAL_PHASES[next];
  if (question !== undefined) return { kind: "needs_decision", phase: next, question };
  const started = await new PhaseEngine(store).start(person, next);
  return started.ok ? { kind: "started", phase: next } : { kind: "start_failed", phase: next, issues: started.issues };
}
