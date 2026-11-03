import type { Event } from "../generated/types.js";
import { nextPhase } from "../engine/phases.js";
import type { MemoryStore } from "./store.js";

type Actor = Event["actor"];

export type SessionResult = { ok: true; sessionId: string } | { ok: false; message: string };

const issuesText = (issues: { path: string; message: string }[]) => issues.map((i) => `${i.path} ${i.message}`.trim()).join("; ");

/**
 * Records that a tool's session began work on the project (HND-8), under the phase being worked
 * on (the first one not approved or skipped). The session's id is the event's id. Only a link to
 * the transcript is stored, never its text; secrets in the link are removed like in any event.
 */
export async function startSession(store: MemoryStore, actor: Actor, options: { transcript?: string } = {}): Promise<SessionResult> {
  const phase = nextPhase(store.readProject().flow, await store.readState());
  const payload = { ...(phase ? { phase } : {}), ...(options.transcript ? { transcript: options.transcript } : {}) };
  const recorded = await store.appendEvent({ type: "session_started", actor, payload });
  return recorded.ok ? { ok: true, sessionId: recorded.event.id } : { ok: false, message: issuesText(recorded.issues) };
}

/** Records that a session ended. Ending one twice writes nothing; an id that is no session is refused. */
export async function endSession(store: MemoryStore, actor: Actor, sessionId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  // Checked inside the store's lock, so two ends racing (a closed pipe and a stop signal) write one.
  let alreadyEnded = false;
  const recorded = await store.appendEvent({ type: "session_ended", actor, payload: { sessionId } }, (_state, events) => {
    if (!events.some((e) => e.type === "session_started" && e.id === sessionId)) {
      return [{ path: "/payload/sessionId", message: `No session started with id ${sessionId}.` }];
    }
    alreadyEnded = events.some((e) => e.type === "session_ended" && (e.payload as { sessionId?: string }).sessionId === sessionId);
    return alreadyEnded ? [{ path: "/payload/sessionId", message: "already ended" }] : [];
  });
  if (recorded.ok || alreadyEnded) return { ok: true };
  return { ok: false, message: issuesText(recorded.issues) };
}
