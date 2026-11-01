import { FLOWS, PLANNING_PHASES } from "../generated/contract.js";
import type { Event, State } from "../generated/types.js";
import type { MemoryStore, EventInput } from "../memory/store.js";
import type { ValidationIssue } from "../validate.js";

/** Asked at the end of every phase (GATE-2). Tools show it to the user with the documents. */
export const REVIEW_QUESTION = "Have you reviewed this? Any doubts, questions, changes or add-ons?";

type Actor = Event["actor"];
type Flows = Readonly<Record<string, readonly string[]>>;
type SkillUse = { skill: string; evidence: string };

export type PhaseAction =
  | { kind: "start"; phase: string }
  | { kind: "submit"; phase: string; documents: string[]; skillsUsed: SkillUse[]; understandingCheck?: string }
  | { kind: "approve"; phase: string }
  | { kind: "request_changes"; phase: string; notes: string };

export interface PhaseContext {
  state: State;
  /** Every event so far, oldest first (the new event is not included). */
  events: Event[];
  flow: string;
  flows: Flows;
  /** Phases that need an Understanding check when submitted. */
  planning: readonly string[];
}

export type CheckResult = { ok: true } | { ok: false; issues: ValidationIssue[] };

const problem = (message: string): CheckResult => ({ ok: false, issues: [{ path: "", message }] });

/** Pure rule check for one phase action (GATE-1..4, UND-1). Used inside the store's lock. */
export function checkPhaseAction(ctx: PhaseContext, action: PhaseAction, actor: Actor): CheckResult {
  const order = ctx.flows[ctx.flow];
  if (!order) return problem(`unknown flow "${ctx.flow}"`);
  const { phase } = action;
  if (!order.includes(phase)) {
    return problem(`"${phase}" is not part of the ${ctx.flow} flow (its phases are: ${order.join(", ")})`);
  }
  const status = ctx.state.phases[phase]?.status ?? "not_started";

  switch (action.kind) {
    case "start": {
      if (status !== "not_started") return problem(`"${phase}" is already ${status}`);
      const previous = order[order.indexOf(phase) - 1];
      if (previous && ctx.state.phases[previous]?.status !== "approved") {
        return problem(`"${previous}" must be approved before "${phase}" can start`);
      }
      return { ok: true };
    }
    case "submit": {
      if (status === "not_started") return problem(`"${phase}" has not been started; start it first`);
      if (status !== "in_progress" && status !== "changes_requested") {
        return problem(`"${phase}" is ${status}; there is nothing to submit`);
      }
      // GATE-3: the memory must have been updated since work on this phase (re)started.
      const reopenedAt = findLastIndex(
        ctx.events,
        (e) => (e.type === "phase_started" || e.type === "changes_requested") && (e.payload as { phase?: string }).phase === phase,
      );
      if (!ctx.events.slice(reopenedAt + 1).some((e) => e.type === "memory_updated")) {
        return problem(`update the project memory (a memory_updated event) after working on "${phase}", then submit it`);
      }
      if (ctx.planning.includes(phase) && !action.understandingCheck) {
        return problem(
          `"${phase}" is a planning phase: include the confirmed Understanding check (understandingCheck) when submitting it`,
        );
      }
      return { ok: true };
    }
    case "approve":
    case "request_changes": {
      if (actor.kind !== "human") {
        const verb = action.kind === "approve" ? "approve" : "request changes to";
        return problem(`Only a person can ${verb} a phase. Ask the user to review "${phase}" in the extension or desktop app.`);
      }
      if (status !== "awaiting_review") return problem(`"${phase}" is not awaiting review (it is ${status})`);
      return { ok: true };
    }
  }
}

function findLastIndex<T>(items: T[], test: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) if (test(items[i])) return i;
  return -1;
}

function toEventInput(action: PhaseAction, actor: Actor): EventInput {
  switch (action.kind) {
    case "start":
      return { type: "phase_started", actor, payload: { phase: action.phase } };
    case "submit":
      return {
        type: "phase_submitted",
        actor,
        payload: {
          phase: action.phase,
          documents: action.documents,
          skillsUsed: action.skillsUsed,
          ...(action.understandingCheck ? { understandingCheck: action.understandingCheck } : {}),
        },
      };
    case "approve":
      return { type: "phase_approved", actor, payload: { phase: action.phase } };
    case "request_changes":
      return { type: "changes_requested", actor, payload: { phase: action.phase, notes: action.notes } };
  }
}

/** The first phase of the flow that is not yet approved, or null when all are. */
export function nextPhase(flow: string, state: State, flows: Flows = FLOWS): string | null {
  return (flows[flow] ?? []).find((phase) => state.phases[phase]?.status !== "approved") ?? null;
}

export type PhaseResult =
  | { ok: true; event: Event; /** Present after a submit: ask the user this. */ reviewQuestion?: string }
  | { ok: false; issues: ValidationIssue[] };

/** Applies phase actions to a project's memory, enforcing the rules atomically. */
export class PhaseEngine {
  private readonly flows: Flows;
  private readonly planning: readonly string[];

  constructor(
    private readonly store: MemoryStore,
    options: { flows?: Flows; planning?: readonly string[] } = {},
  ) {
    this.flows = options.flows ?? FLOWS;
    this.planning = options.planning ?? PLANNING_PHASES;
  }

  start(actor: Actor, phase: string): Promise<PhaseResult> {
    return this.act(actor, { kind: "start", phase });
  }

  async submit(
    actor: Actor,
    submission: { phase: string; documents: string[]; skillsUsed: SkillUse[]; understandingCheck?: string },
  ): Promise<PhaseResult> {
    const result = await this.act(actor, { kind: "submit", ...submission });
    return result.ok ? { ...result, reviewQuestion: REVIEW_QUESTION } : result;
  }

  approve(actor: Actor, phase: string): Promise<PhaseResult> {
    return this.act(actor, { kind: "approve", phase });
  }

  requestChanges(actor: Actor, phase: string, notes: string): Promise<PhaseResult> {
    return this.act(actor, { kind: "request_changes", phase, notes });
  }

  private async act(actor: Actor, action: PhaseAction): Promise<PhaseResult> {
    const context = (state: State, events: Event[]): PhaseContext => ({
      state,
      events,
      flow: state.flow,
      flows: this.flows,
      planning: this.planning,
    });
    // Early check for a clear message (for example, an agent trying to approve would
    // otherwise only see the schema's "must be equal to constant").
    const early = checkPhaseAction(context(await this.store.readState(), (await this.store.readEvents()).events), action, actor);
    if (!early.ok) return early;
    // The same check again inside the lock makes check-and-write atomic.
    return this.store.appendEvent(toEventInput(action, actor), (state, events) => {
      const atomic = checkPhaseAction(context(state, events), action, actor);
      return atomic.ok ? [] : atomic.issues;
    });
  }
}
