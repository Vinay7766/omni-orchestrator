import type { Event, State } from "../generated/types.js";

type Flow = State["flow"];
type Task = State["tasks"][number];

/** State of a project before any phase or task has happened. */
export function initialState(flow: Flow): State {
  return { formatVersion: 1, flow, currentPhase: null, phases: {}, tasks: [], lastEventId: null };
}

/**
 * Applies one event to the state and returns a new state (the input is not changed).
 * This only records what happened; whether a transition is allowed is decided before the
 * event is written (phase and task engines, C5/C6).
 */
export function applyEvent(state: State, event: Event): State {
  const payload = event.payload as Record<string, string>;
  const next: State = { ...state, phases: { ...state.phases }, tasks: state.tasks.map((t) => ({ ...t })), lastEventId: event.id };
  const setPhase = (status: State["phases"][string]["status"], extra: Partial<State["phases"][string]> = {}) => {
    next.phases[payload.phase] = { ...next.phases[payload.phase], status, ...extra };
  };
  const updateTask = (change: (task: Task) => void) => {
    const task = next.tasks.find((t) => t.id === payload.taskId);
    if (task) change(task);
  };

  switch (event.type) {
    case "project_created":
      next.flow = (event.payload as { flow: Flow }).flow;
      break;
    case "phase_started":
      next.currentPhase = payload.phase;
      setPhase("in_progress");
      break;
    case "phase_submitted":
      setPhase("awaiting_review", { submittedAt: event.time });
      break;
    case "changes_requested":
      setPhase("changes_requested", { decidedAt: event.time });
      break;
    case "phase_approved":
      setPhase("approved", { decidedAt: event.time });
      break;
    case "phase_skipped":
      setPhase("skipped", { decidedAt: event.time });
      break;
    case "task_created":
      if (!next.tasks.some((t) => t.id === payload.taskId)) {
        next.tasks.push({ id: payload.taskId, title: payload.title, status: "todo" });
      }
      break;
    case "design_note_submitted":
      updateTask((t) => {
        t.status = "designed";
        t.designNote = payload.notePath;
      });
      break;
    case "task_marked_trivial":
      updateTask((t) => {
        t.status = "designed";
        t.trivialReason = payload.reason;
      });
      break;
    case "task_started":
      updateTask((t) => {
        t.status = "in_progress";
      });
      break;
    case "task_completed":
      updateTask((t) => {
        t.status = "done";
      });
      break;
    case "task_reopened":
      // A reopened task needs a new design (solution-design step 7).
      updateTask((t) => {
        t.status = "todo";
        delete t.designNote;
        delete t.trivialReason;
      });
      break;
    default:
      // Decisions, problems, lessons, tool selection and memory updates don't change the
      // snapshot; the summary writer (C8) reads them from the log.
      break;
  }
  return next;
}

/** Rebuilds the full state from the event log. */
export function rebuild(flow: Flow, events: Event[]): State {
  return events.reduce(applyEvent, initialState(flow));
}
