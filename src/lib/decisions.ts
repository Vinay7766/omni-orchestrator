/**
 * The person's decisions in the desktop app (E3 slice 3, GATE-2, SEC-1): approve, request changes,
 * run or skip an optional phase. They go through @omni/core's PhaseEngine over the app's memfs
 * commands, and what follows uses the same rule as the extension (continueAfterDecision), so the
 * app never starts an optional phase for the person.
 */
import { continueAfterDecision, createInvokeFs, MemoryStore, normalizePath, PhaseEngine, type Invoke, type MemoryStore as Store } from "@omni/core";

/** The person at the desktop app. */
export const DESKTOP_PERSON = { kind: "human" as const, tool: "omni-desktop" };

export type DecisionResult = { ok: boolean; message: string };

const issuesText = (issues: { message: string }[]) => issues.map((i) => i.message).join("; ");

async function openStore(invoke: Invoke, root: string): Promise<Store> {
  const opened = await MemoryStore.open(createInvokeFs(invoke), normalizePath(root));
  if (!opened.ok) throw new Error(opened.issues.map((i) => `${i.path} ${i.message}`.trim()).join("; "));
  return opened.store;
}

async function whatNext(store: Store): Promise<string> {
  const next = await continueAfterDecision(store, DESKTOP_PERSON);
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
      return `"${next.phase}" needs your decision: ${next.question}`;
  }
}

/** Runs one decision; any failure (memory unreadable, rule refused) comes back as its real reason. */
async function decide(invoke: Invoke, root: string, act: (store: Store, engine: PhaseEngine) => Promise<DecisionResult>): Promise<DecisionResult> {
  try {
    const store = await openStore(invoke, root);
    return await act(store, new PhaseEngine(store));
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export const approve = (invoke: Invoke, root: string, phase: string) =>
  decide(invoke, root, async (store, engine) => {
    const r = await engine.approve(DESKTOP_PERSON, phase);
    return r.ok ? { ok: true, message: `"${phase}" approved. ${await whatNext(store)}` } : { ok: false, message: issuesText(r.issues) };
  });

export const requestChanges = (invoke: Invoke, root: string, phase: string, notes: string) =>
  decide(invoke, root, async (_store, engine) => {
    const r = await engine.requestChanges(DESKTOP_PERSON, phase, notes);
    return r.ok ? { ok: true, message: `Changes requested for "${phase}".` } : { ok: false, message: issuesText(r.issues) };
  });

/** The person agrees to run an optional phase: starting it is the consent (SEC-1). */
export const runOptional = (invoke: Invoke, root: string, phase: string) =>
  decide(invoke, root, async (_store, engine) => {
    const r = await engine.start(DESKTOP_PERSON, phase);
    return r.ok ? { ok: true, message: `"${phase}" has started.` } : { ok: false, message: issuesText(r.issues) };
  });

/** The person declines an optional phase (recorded with the reason), then the flow continues. */
export const skipOptional = (invoke: Invoke, root: string, phase: string, reason?: string) =>
  decide(invoke, root, async (store, engine) => {
    const r = await engine.skip(DESKTOP_PERSON, phase, reason?.trim() || undefined);
    return r.ok ? { ok: true, message: `"${phase}" skipped. ${await whatNext(store)}` } : { ok: false, message: issuesText(r.issues) };
  });
