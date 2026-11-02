/**
 * The person's side of a phase gate (GATE-2, GATE-4): approve a submitted phase or request
 * changes. Rules live in @omni/core's PhaseEngine; this asks the person and records their answer.
 * The vscode layer (extension.ts) supplies the Ui; tests supply a scripted one.
 */
import { nextPhase, OPTIONAL_PHASES, PhaseEngine, REVIEW_QUESTION, type Event, type MemoryStore } from "@omni/core";

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

/**
 * Asks the person about an optional phase (SEC-1): run it (they start it) or skip it (recorded).
 * Closing the question decides nothing. After a skip, the next phase starts as usual.
 */
async function askAboutOptional(phases: PhaseEngine, store: MemoryStore, person: Actor, ui: GateUi, phase: string): Promise<string> {
  const choice = await ui.choose(OPTIONAL_PHASES[phase], `"${phase}" is optional. Only you can decide whether it runs.`, [RUN, SKIP]);
  if (choice === RUN) {
    const started = await phases.start(person, phase);
    return started.ok ? `"${phase}" has started.` : `"${phase}" could not start: ${issuesText(started.issues)}`;
  }
  if (choice === SKIP) {
    const skipped = await phases.skip(person, phase);
    if (!skipped.ok) return `"${phase}" could not be skipped: ${issuesText(skipped.issues)}`;
    const after = nextPhase(store.readProject().flow, await store.readState());
    if (after === null) return `"${phase}" skipped. Every phase is done.`;
    const started = await phases.start(person, after);
    return started.ok ? `"${phase}" skipped. "${after}" has started.` : `"${phase}" skipped, but "${after}" could not start: ${issuesText(started.issues)}`;
  }
  return `"${phase}" waits for your decision. Run "OmniOrchestrator: Decide optional phase" when you are ready.`;
}

/** Approves the phase under review after the person confirms, then starts the next phase. */
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

  const phases = new PhaseEngine(store);
  const approved = await phases.approve(person, review.phase);
  if (!approved.ok) {
    ui.show(`Not approved: ${issuesText(approved.issues)}`);
    return;
  }
  const next = nextPhase(store.readProject().flow, await store.readState());
  if (next === null) {
    ui.show(`"${review.phase}" approved. Every phase is done.`);
    return;
  }
  // Never start an optional phase on the person's behalf: approving one phase is not consent to the next.
  if (OPTIONAL_PHASES[next] !== undefined) {
    ui.show(`"${review.phase}" approved. ${await askAboutOptional(phases, store, person, ui, next)}`);
    return;
  }
  const started = await phases.start(person, next);
  ui.show(
    started.ok
      ? `"${review.phase}" approved. "${next}" has started.`
      : `"${review.phase}" approved, but "${next}" could not start: ${issuesText(started.issues)}`,
  );
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
  const state = await store.readState();
  const next = nextPhase(store.readProject().flow, state);
  if (next === null || OPTIONAL_PHASES[next] === undefined || (state.phases[next]?.status ?? "not_started") !== "not_started") {
    ui.show("Nothing to decide: the next phase is not an optional one waiting for you.");
    return;
  }
  ui.show(await askAboutOptional(new PhaseEngine(store), store, person, ui, next));
}
