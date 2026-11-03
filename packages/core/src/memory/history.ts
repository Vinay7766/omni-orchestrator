import { FLOWS, OPTIONAL_PHASES } from "../generated/contract.js";
import type { Event, State } from "../generated/types.js";
import type { MemoryStore } from "./store.js";

type Actor = Event["actor"];
type PhaseStatus = State["phases"][string]["status"];

/** One phase's record (GATE-5): what was produced and what the person decided. */
export interface PhaseHistoryEntry {
  phase: string;
  status: PhaseStatus;
  /** The phase to work on now: the first one not approved or skipped. */
  isNext: boolean;
  /** Set for an optional phase: the question its person is asked (SEC-1). */
  optionalQuestion?: string;
  started?: { time: string; by: Actor };
  /** Every hand-in, oldest first (a phase is resubmitted after changes are requested). */
  submissions: {
    time: string;
    by: Actor;
    documents: string[];
    skillsUsed: { skill: string; evidence: string }[];
    understandingCheck?: string;
    /** The stack ADR referenced (architecture phase, STK-1..3). */
    stackAdr?: string;
  }[];
  changeRequests: { time: string; by: Actor; notes: string }[];
  decision?: { kind: "approved" | "skipped"; time: string; by: Actor; reason?: string };
  /** The tool sessions that worked on this phase, oldest first (HND-8). */
  sessions: { id: string; by: Actor; started: string; ended?: string; transcript?: string }[];
}

const isDone = (status: PhaseStatus | undefined) => status === "approved" || status === "skipped";

/** Builds the per-phase record from the snapshot and the event log (the source of truth). */
export function buildPhaseHistory(
  flow: string,
  state: State,
  events: Event[],
  options: { flows?: Readonly<Record<string, readonly string[]>>; optional?: Readonly<Record<string, string>> } = {},
): PhaseHistoryEntry[] {
  const flows: Readonly<Record<string, readonly string[]>> = options.flows ?? FLOWS;
  const order = flows[flow] ?? [];
  const optional = options.optional ?? OPTIONAL_PHASES;
  const next = order.find((phase) => !isDone(state.phases[phase]?.status)) ?? null;
  const entries = new Map<string, PhaseHistoryEntry>(
    order.map((phase) => [
      phase,
      {
        phase,
        status: state.phases[phase]?.status ?? "not_started",
        isNext: phase === next,
        ...(optional[phase] !== undefined ? { optionalQuestion: optional[phase] } : {}),
        submissions: [],
        changeRequests: [],
        sessions: [],
      },
    ]),
  );

  const sessions = new Map<string, PhaseHistoryEntry["sessions"][number]>();
  for (const event of events) {
    const payload = event.payload as Record<string, unknown>;
    if (event.type === "session_ended") {
      const session = sessions.get(String(payload.sessionId));
      if (session) session.ended = event.time;
      continue;
    }
    const entry = typeof payload.phase === "string" ? entries.get(payload.phase) : undefined;
    if (!entry) continue;
    const at = { time: event.time, by: event.actor };
    switch (event.type) {
      case "phase_started":
        entry.started = at;
        break;
      case "phase_submitted":
        entry.submissions.push({
          ...at,
          documents: (payload.documents as string[] | undefined) ?? [],
          skillsUsed: (payload.skillsUsed as { skill: string; evidence: string }[] | undefined) ?? [],
          ...(typeof payload.understandingCheck === "string" ? { understandingCheck: payload.understandingCheck } : {}),
          ...(typeof payload.stackAdr === "string" ? { stackAdr: payload.stackAdr } : {}),
        });
        break;
      case "changes_requested":
        entry.changeRequests.push({ ...at, notes: String(payload.notes ?? "") });
        break;
      case "phase_approved":
        entry.decision = { kind: "approved", ...at };
        break;
      case "session_started": {
        const session = { id: event.id, by: event.actor, started: event.time, ...(typeof payload.transcript === "string" ? { transcript: payload.transcript } : {}) };
        sessions.set(event.id, session);
        entry.sessions.push(session);
        break;
      }
      case "phase_skipped":
        entry.decision = { kind: "skipped", ...at, ...(typeof payload.reason === "string" ? { reason: payload.reason } : {}) };
        break;
      default:
        break;
    }
  }
  return [...entries.values()];
}

/** A project's phase history, read from its memory. Read-only. */
export async function phaseHistory(store: MemoryStore): Promise<PhaseHistoryEntry[]> {
  const { events } = await store.readEvents();
  return buildPhaseHistory(store.readProject().flow, await store.readState(), events);
}
