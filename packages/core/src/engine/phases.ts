import { FLOWS, OPTIONAL_PHASES, PLANNING_PHASES, STACK_ADR_PHASES } from "../generated/contract.js";
import type { Event, State } from "../generated/types.js";
import type { MemoryStore, EventInput } from "../memory/store.js";
import type { ValidationIssue } from "../validate.js";
import { refreshMemoryDocs } from "../memory/docs.js";

/** Asked at the end of every phase (GATE-2). Tools show it to the user with the documents. */
export const REVIEW_QUESTION = "Have you reviewed this? Any doubts, questions, changes or add-ons?";

type Actor = Event["actor"];
type Flows = Readonly<Record<string, readonly string[]>>;
type SkillUse = { skill: string; evidence: string };

export type PhaseAction =
  | { kind: "start"; phase: string }
  | { kind: "submit"; phase: string; documents: string[]; skillsUsed: SkillUse[]; understandingCheck?: string; stackAdr?: string }
  | { kind: "approve"; phase: string }
  | { kind: "skip"; phase: string; reason?: string }
  | { kind: "request_changes"; phase: string; notes: string }
  | { kind: "withdraw"; phase: string };

/** Events that are not work: a tool opening or closing a session, or the next phase starting. */
const NOT_WORK: ReadonlySet<string> = new Set(["phase_started", "session_started", "session_ended"]);

export interface PhaseContext {
  state: State;
  /** Every event so far, oldest first (the new event is not included). */
  events: Event[];
  flow: string;
  flows: Flows;
  /** Phases that need an Understanding check when submitted. */
  planning: readonly string[];
  /** Phases whose submission must reference a stack ADR (STK-1..3); none when left out. */
  stackAdr?: readonly string[];
  /** Phases a person may decline, each with the question to ask (GATE-1, SEC-1). */
  optional?: Readonly<Record<string, string>>;
}

export type CheckResult = { ok: true } | { ok: false; issues: ValidationIssue[] };

const problem = (message: string): CheckResult => ({ ok: false, issues: [{ path: "", message }] });

/** Approved, or (for an optional phase) skipped by a person: the next phase may start. */
const isDone = (status: string | undefined) => status === "approved" || status === "skipped";

/** The previous phase that is not done yet, if any. */
function blockedBy(ctx: PhaseContext, order: readonly string[], phase: string): string | null {
  const previous = order[order.indexOf(phase) - 1];
  return previous && !isDone(ctx.state.phases[previous]?.status) ? previous : null;
}

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
      const previous = blockedBy(ctx, order, phase);
      if (previous) return problem(`"${previous}" must be approved before "${phase}" can start`);
      // SEC-1: running an optional phase needs a person's consent; starting it is that consent.
      const question = ctx.optional?.[phase];
      if (question !== undefined && actor.kind !== "human") {
        return problem(
          `Only a person can decide whether to run "${phase}". Ask the user: "${question}" They start it (yes) or skip it (no) in the extension or desktop app.`,
        );
      }
      return { ok: true };
    }
    case "skip": {
      if (ctx.optional?.[phase] === undefined) return problem(`"${phase}" is not optional; it cannot be skipped`);
      if (actor.kind !== "human") {
        return problem(`Only a person can skip "${phase}". Ask the user: "${ctx.optional[phase]}"`);
      }
      if (status !== "not_started") return problem(`"${phase}" is already ${status}; only a phase that has not started can be skipped`);
      const previous = blockedBy(ctx, order, phase);
      if (previous) return problem(`"${previous}" must be approved before "${phase}" can be decided`);
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
      if (ctx.stackAdr?.includes(phase) && !action.stackAdr) {
        return problem(`"${phase}" needs a stack decision record: include the ADR (stackAdr) written with the stack-selection skill`);
      }
      return { ok: true };
    }
    case "withdraw": {
      // Owner's v0.1 issue D: take back an approval, only while nothing has happened since it.
      if (actor.kind !== "human") return problem("Only a person can withdraw an approval.");
      if (status !== "approved") return problem(`"${phase}" is not approved (it is ${status})`);
      const approvedAt = findLastIndex(ctx.events, (e) => e.type === "phase_approved" && (e.payload as { phase?: string }).phase === phase);
      const work = ctx.events.slice(approvedAt + 1).find((e) => !NOT_WORK.has(e.type));
      if (work) return problem(`work has already been recorded since "${phase}" was approved (${work.type.replace(/_/g, " ")}), so the approval can no longer be withdrawn`);
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
          ...(action.stackAdr ? { stackAdr: action.stackAdr } : {}),
        },
      };
    case "approve":
      return { type: "phase_approved", actor, payload: { phase: action.phase } };
    case "skip":
      return { type: "phase_skipped", actor, payload: { phase: action.phase, ...(action.reason ? { reason: action.reason } : {}) } };
    case "request_changes":
      return { type: "changes_requested", actor, payload: { phase: action.phase, notes: action.notes } };
    case "withdraw":
      return { type: "approval_withdrawn", actor, payload: { phase: action.phase } };
  }
}

/** The first phase of the flow that is not done (approved, or skipped), or null when all are. */
export function nextPhase(flow: string, state: State, flows: Flows = FLOWS): string | null {
  return (flows[flow] ?? []).find((phase) => !isDone(state.phases[phase]?.status)) ?? null;
}

export type PhaseResult =
  | {
      ok: true;
      event: Event;
      /** Present after a submit: ask the user this. */
      reviewQuestion?: string;
      /** Set if the action was recorded but the memory documents could not be refreshed. */
      warning?: string;
    }
  | { ok: false; issues: ValidationIssue[] };

/** Refreshes summary.md and friends; never undoes an action that was already recorded. */
export async function refreshAfter<R extends { ok: boolean }>(store: MemoryStore, result: R): Promise<R & { warning?: string }> {
  if (!result.ok) return result;
  try {
    await refreshMemoryDocs(store);
    return result;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ...result, warning: `recorded, but the memory documents could not be refreshed: ${reason}` };
  }
}

/** Applies phase actions to a project's memory, enforcing the rules atomically. */
export class PhaseEngine {
  private readonly flows: Flows;
  private readonly planning: readonly string[];
  private readonly stackAdr: readonly string[];
  private readonly optional: Readonly<Record<string, string>>;

  constructor(
    private readonly store: MemoryStore,
    options: { flows?: Flows; planning?: readonly string[]; stackAdr?: readonly string[]; optional?: Readonly<Record<string, string>> } = {},
  ) {
    this.flows = options.flows ?? FLOWS;
    this.planning = options.planning ?? PLANNING_PHASES;
    this.stackAdr = options.stackAdr ?? STACK_ADR_PHASES;
    this.optional = options.optional ?? OPTIONAL_PHASES;
  }

  start(actor: Actor, phase: string): Promise<PhaseResult> {
    return this.act(actor, { kind: "start", phase });
  }

  async submit(
    actor: Actor,
    submission: { phase: string; documents: string[]; skillsUsed: SkillUse[]; understandingCheck?: string; stackAdr?: string },
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

  /** A person takes back an approval while nothing has happened since it (issue D). */
  withdrawApproval(actor: Actor, phase: string): Promise<PhaseResult> {
    return this.act(actor, { kind: "withdraw", phase });
  }

  /** A person declines an optional phase (SEC-1); recorded with time and actor. */
  skip(actor: Actor, phase: string, reason?: string): Promise<PhaseResult> {
    return this.act(actor, { kind: "skip", phase, ...(reason ? { reason } : {}) });
  }

  private async act(actor: Actor, action: PhaseAction): Promise<PhaseResult> {
    const context = (state: State, events: Event[]): PhaseContext => ({
      state,
      events,
      flow: state.flow,
      flows: this.flows,
      planning: this.planning,
      stackAdr: this.stackAdr,
      optional: this.optional,
    });
    // Early check for a clear message (for example, an agent trying to approve would
    // otherwise only see the schema's "must be equal to constant").
    const early = checkPhaseAction(context(await this.store.readState(), (await this.store.readEvents()).events), action, actor);
    if (!early.ok) return early;
    // The same check again inside the lock makes check-and-write atomic.
    const result = await this.store.appendEvent(toEventInput(action, actor), (state, events) => {
      const atomic = checkPhaseAction(context(state, events), action, actor);
      return atomic.ok ? [] : atomic.issues;
    });
    return refreshAfter(this.store, result);
  }
}
