/**
 * The person's side of a phase gate (GATE-2, GATE-4): approve a submitted phase or request
 * changes. Rules live in @omni/core's PhaseEngine; this asks the person and records their answer.
 * The vscode layer (extension.ts) supplies the Ui; tests supply a scripted one.
 */
import { nextPhase, PhaseEngine, REVIEW_QUESTION, type Event, type MemoryStore } from "@omni/core";

type Actor = Event["actor"];

export interface GateUi {
  /** Asks the person to confirm; true only when they explicitly accept. */
  confirm(message: string, detail: string): Promise<boolean>;
  /** Asks for the changes wanted; undefined when cancelled. */
  askNotes(phase: string): Promise<string | undefined>;
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
    ui.show(`"${review.phase}" approved. Every phase is approved.`);
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
