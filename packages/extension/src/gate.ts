/**
 * The person's side of a phase gate (GATE-2, GATE-4): approve a submitted phase or request
 * changes. Rules live in @omni/core's PhaseEngine; this asks the person and records their answer.
 * The vscode layer (extension.ts) supplies the Ui; tests supply a scripted one.
 */
import { continueAfterDecision, PhaseEngine, REVIEW_QUESTION, type ContinueResult, type Event, type MemoryStore } from "@omni/core";

type Actor = Event["actor"];

export interface GateUi {
  /** Asks the person to confirm; true only when they explicitly accept. */
  confirm(message: string, detail: string): Promise<boolean>;
  /** Asks for the changes wanted; undefined when cancelled. */
  askNotes(phase: string): Promise<string | undefined>;
  /** Offers the person a choice; undefined when they close it without choosing. */
  choose(message: string, detail: string, options: readonly string[]): Promise<string | undefined>;
  show(message: string): void;
}

const issuesText = (issues: { message: string }[]) => issues.map((i) => i.message).join("; ");

/** The phase waiting for this person's review, with the documents handed in for it. */
async function underReview(store: MemoryStore): Promise<{ phase: string; documents: string[] } | null> {
  const state = await store.readState();
  const phase = state.currentPhase;
  if (!phase || state.phases[phase]?.status !== "awaiting_review") return null;
  const { events } = await store.readEvents();
  const submission = events.filter((e) => e.type === "phase_submitted" && (e.payload as { phase?: string }).phase === phase).pop();
  return { phase, documents: ((submission?.payload as { documents?: string[] }) ?? {}).documents ?? [] };
}

const RUN = "Run it";
const SKIP = "Skip it";
const WAITING = (phase: string) => `"${phase}" waits for your decision. Run "OmniOrchestrator: Decide optional phase" when you are ready.`;

/**
 * What happens next, after a decision: the shared rule (core's continueAfterDecision) starts the
 * next phase, except an optional one, which the person is asked about here (SEC-1).
 */
async function continueWith(store: MemoryStore, person: Actor, ui: GateUi): Promise<string> {
  const next: ContinueResult = await continueAfterDecision(store, person);
  switch (next.kind) {
    case "done":
      return "Every phase is done.";
    case "started":
      return `"${next.phase}" has started.`;
    case "in_progress":
      return `"${next.phase}" is under way.`;
    case "start_failed":
      return `"${next.phase}" could not start: ${issuesText(next.issues)}`;
    case "needs_decision":
      return askAboutOptional(store, person, ui, next.phase, next.question);
  }
}

/** Run it (the person starts it), skip it (recorded, then the flow continues), or decide later. */
async function askAboutOptional(store: MemoryStore, person: Actor, ui: GateUi, phase: string, question: string): Promise<string> {
  const choice = await ui.choose(question, `"${phase}" is optional. Only you can decide whether it runs.`, [RUN, SKIP]);
  const phases = new PhaseEngine(store);
  if (choice === RUN) {
    const started = await phases.start(person, phase);
    return started.ok ? `"${phase}" has started.` : `"${phase}" could not start: ${issuesText(started.issues)}`;
  }
  if (choice === SKIP) {
    const skipped = await phases.skip(person, phase);
    if (!skipped.ok) return `"${phase}" could not be skipped: ${issuesText(skipped.issues)}`;
    return `"${phase}" skipped. ${await continueWith(store, person, ui)}`;
  }
  return WAITING(phase);
}

/** Approves the phase under review after the person confirms, then continues (see continueWith). */
export async function approvePhase(store: MemoryStore, person: Actor, ui: GateUi): Promise<void> {
  const review = await underReview(store);
  if (!review) {
    ui.show("Nothing is waiting for review.");
    return;
  }
  const detail = [
    review.documents.length ? `Documents: ${review.documents.join(", ")}` : "No documents were listed.",
    "",
    REVIEW_QUESTION,
  ].join("\n");
  if (!(await ui.confirm(`Approve "${review.phase}"?`, detail))) return;

  const approved = await new PhaseEngine(store).approve(person, review.phase);
  if (!approved.ok) {
    ui.show(`Not approved: ${issuesText(approved.issues)}`);
    return;
  }
  ui.show(`"${review.phase}" approved. ${await continueWith(store, person, ui)}`);
}

/** Sends the phase under review back with the person's notes. */
export async function requestChanges(store: MemoryStore, person: Actor, ui: GateUi): Promise<void> {
  const review = await underReview(store);
  if (!review) {
    ui.show("Nothing is waiting for review.");
    return;
  }
  const notes = (await ui.askNotes(review.phase))?.trim();
  if (!notes) return;
  const result = await new PhaseEngine(store).requestChanges(person, review.phase, notes);
  ui.show(result.ok ? `Changes requested for "${review.phase}".` : `Not recorded: ${issuesText(result.issues)}`);
}

/** Lets the person decide an optional phase that is waiting for them (SEC-1). */
export async function decideOptionalPhase(store: MemoryStore, person: Actor, ui: GateUi): Promise<void> {
  const next = await continueAfterDecision(store, person);
  if (next.kind !== "needs_decision") {
    ui.show("Nothing to decide: the next phase is not an optional one waiting for you.");
    return;
  }
  ui.show(await askAboutOptional(store, person, ui, next.phase, next.question));
}
