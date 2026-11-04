/**
 * What a person sees at a gate (C18, GATE-6): a short summary of the phase's latest submission and
 * what was recorded since the last gate decision, built only from the event log (NFR-7). The app
 * renders the structure; the extension shows `gateReviewText` in its approve dialog.
 *
 * Also the batch safeguard (owner decision 2026-11-03): phases are approved one at a time, and no
 * channel offers bulk approval. If the log ever shows several phases approved together, each is
 * labelled "Approved as a batch" with every phase in it (see `findBatchApprovals`).
 */
import type { Event } from "../generated/types.js";

type Actor = Event["actor"];

/** Approvals closer together than this belong to one batch: a real review takes far longer. */
export const BATCH_WINDOW_MS = 60_000;

const MAX_LINE_TEXT = 200;
const oneLine = (text: unknown) => {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > MAX_LINE_TEXT ? `${flat.slice(0, MAX_LINE_TEXT - 3)}...` : flat;
};

export interface GateReview {
  phase: string;
  submission: {
    time: string;
    by: Actor;
    documents: string[];
    skillsUsed: { skill: string; evidence: string }[];
    understandingCheck?: string;
    stackAdr?: string;
  };
  /** Change requests made earlier on this phase, oldest first, so the person can check them. */
  earlierChangeRequests: { time: string; notes: string }[];
  since: {
    /** Time of the last gate decision (any phase); null when there was none yet. */
    from: string | null;
    items: { time: string; type: Event["type"]; text: string }[];
    /** Files and commits the recorded entries and the submission point to, each once. */
    files: string[];
    commits: string[];
  };
}

const GATE_DECISIONS: ReadonlySet<Event["type"]> = new Set(["phase_approved", "phase_skipped", "changes_requested", "approval_withdrawn"]);

/** One line per kind of entry; null for events that are part of the gate itself or routine. */
function describe(event: Event): string | null {
  const p = event.payload as Record<string, unknown>;
  switch (event.type) {
    case "decision_recorded":
      return `Decision recorded: ${oneLine(p.title)}`;
    case "problem_recorded":
      return `Problem recorded: ${oneLine(p.title)}`;
    case "lesson_recorded":
      return `Lesson recorded: ${oneLine(p.lesson)}`;
    case "task_created":
      return `Task created: ${oneLine(p.taskId)} ${oneLine(p.title)}`;
    case "design_note_submitted":
      return `Design note submitted: ${oneLine(p.taskId)}`;
    case "task_marked_trivial":
      return `Task marked trivial: ${oneLine(p.taskId)}`;
    case "task_started":
      return `Task started: ${oneLine(p.taskId)}`;
    case "task_completed":
      return `Task completed: ${oneLine(p.taskId)}`;
    case "task_reopened":
      return `Task reopened: ${oneLine(p.taskId)}`;
    case "memory_updated":
      return "Memory updated";
    case "tools_selected":
      return "Tools selected for the project";
    case "project_updated":
      return "Project details changed";
    default:
      return null;
  }
}

/** The review of `phase`'s latest submission; null when the phase was never submitted. */
export function buildGateReview(events: Event[], phase: string): GateReview | null {
  const isThisPhase = (e: Event) => (e.payload as { phase?: unknown }).phase === phase;
  let lastSubmission = -1;
  events.forEach((e, i) => {
    if (e.type === "phase_submitted" && isThisPhase(e)) lastSubmission = i;
  });
  if (lastSubmission < 0) return null;

  let lastGate = -1;
  for (let i = lastSubmission - 1; i >= 0; i--) {
    if (GATE_DECISIONS.has(events[i].type)) {
      lastGate = i;
      break;
    }
  }

  const submitted = events[lastSubmission];
  const p = submitted.payload as Record<string, unknown>;
  const documents = ((p.documents as string[] | undefined) ?? []).map(String);
  const files = new Set<string>();
  const commits = new Set<string>();
  const items: GateReview["since"]["items"] = [];
  for (const event of events.slice(lastGate + 1)) {
    const text = describe(event);
    if (text === null && event !== submitted) continue;
    if (text !== null) items.push({ time: event.time, type: event.type, text });
    for (const f of event.refs?.files ?? []) files.add(f);
    for (const c of event.refs?.commits ?? []) commits.add(c);
  }
  for (const d of documents) files.add(d);

  return {
    phase,
    submission: {
      time: submitted.time,
      by: submitted.actor,
      documents,
      skillsUsed: (p.skillsUsed as { skill: string; evidence: string }[] | undefined) ?? [],
      ...(typeof p.understandingCheck === "string" ? { understandingCheck: p.understandingCheck } : {}),
      ...(typeof p.stackAdr === "string" ? { stackAdr: p.stackAdr } : {}),
    },
    earlierChangeRequests: events
      .slice(0, lastSubmission)
      .filter((e) => e.type === "changes_requested" && isThisPhase(e))
      .map((e) => ({ time: e.time, notes: oneLine((e.payload as { notes?: unknown }).notes) })),
    since: { from: lastGate >= 0 ? events[lastGate].time : null, items, files: [...files], commits: [...commits] },
  };
}

const who = (actor: Actor) => (actor.kind === "human" ? `a person (${actor.tool})` : `${actor.tool}${actor.model ? ` (${actor.model})` : ""}`);

/** The review as plain text, for a dialog that shows text only (the extension). */
export function gateReviewText(review: GateReview): string {
  const s = review.submission;
  const lines = [`Submitted by ${who(s.by)} at ${s.time}`];
  lines.push(s.documents.length ? `Documents: ${s.documents.join(", ")}` : "No documents were listed.");
  if (s.understandingCheck) lines.push(`Understanding check: ${s.understandingCheck}`);
  if (s.stackAdr) lines.push(`Stack decision record: ${s.stackAdr}`);
  if (s.skillsUsed.length) lines.push("Skills used:", ...s.skillsUsed.map((k) => `- ${oneLine(k.skill)}: ${oneLine(k.evidence)}`));
  for (const c of review.earlierChangeRequests) lines.push(`You asked for changes before: ${c.notes}`);
  const since = review.since.from ? `Since the last gate (${review.since.from})` : "Since the project started";
  if (review.since.items.length === 0) {
    lines.push(`${since}: nothing else was recorded.`);
  } else {
    lines.push(`${since}:`, ...review.since.items.map((i) => `- ${i.text}`));
  }
  if (review.since.files.length) lines.push(`Files: ${review.since.files.join(", ")}`);
  if (review.since.commits.length) lines.push(`Commits: ${review.since.commits.join(", ")}`);
  return lines.join("\n");
}

export interface BatchApproval {
  phases: string[];
  from: string;
  to: string;
}

/**
 * Person approvals of different phases made within BATCH_WINDOW_MS of the one before. The app
 * never does this; a batch in the log means approvals were made without time to review.
 */
export function findBatchApprovals(events: Event[], windowMs = BATCH_WINDOW_MS): BatchApproval[] {
  const approvals = events.filter((e) => e.type === "phase_approved" && e.actor.kind === "human");
  const batches: BatchApproval[] = [];
  let run: Event[] = [];
  const close = () => {
    const phases = [...new Set(run.map((e) => String((e.payload as { phase?: unknown }).phase)))];
    if (phases.length > 1) batches.push({ phases, from: run[0].time, to: run[run.length - 1].time });
  };
  for (const approval of approvals) {
    const previous = run[run.length - 1];
    if (previous && Date.parse(approval.time) - Date.parse(previous.time) <= windowMs) {
      run.push(approval);
    } else {
      if (run.length) close();
      run = [approval];
    }
  }
  if (run.length) close();
  return batches;
}
