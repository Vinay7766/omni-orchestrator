import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "./store.js";
import { createNodeFs } from "./node-fs.js";
import { PhaseEngine } from "../engine/phases.js";
import { phaseHistory } from "./history.js";
import { endSession, startSession } from "./sessions.js";

// E10 / HND-8: every AI session that works on a project is recorded, under the phase it worked on.

const fs = createNodeFs();
const person = { kind: "human" as const, tool: "omni-desktop" };
const madeUp = { kind: "agent" as const, tool: "made-up-agent", model: "made-up-model" };

let root: string;
let store: MemoryStore;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "omni-sessions-"));
  const created = await MemoryStore.create(fs, root, { name: "p", flow: "build", mode: "full", actor: person });
  if (!created.ok) throw new Error(JSON.stringify(created.issues));
  store = created.store;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("startSession / endSession", () => {
  it("records a made-up tool's session under the phase being worked on, with its transcript link", async () => {
    const started = await startSession(store, madeUp, { transcript: "made-up-agent://sessions/42" });
    if (!started.ok) throw new Error(started.message);
    const history = await phaseHistory(store);
    expect(history[0].phase).toBe("idea-review");
    expect(history[0].sessions).toEqual([
      { id: started.sessionId, by: madeUp, started: expect.any(String), transcript: "made-up-agent://sessions/42" },
    ]);
    expect(history[1].sessions).toEqual([]);
  });

  it("records the end time when the session ends", async () => {
    const started = await startSession(store, madeUp);
    if (!started.ok) throw new Error(started.message);
    expect(await endSession(store, madeUp, started.sessionId)).toEqual({ ok: true });
    const [session] = (await phaseHistory(store))[0].sessions;
    expect(session.ended).toEqual(expect.any(String));
    expect(session.transcript).toBeUndefined();
  });

  it("puts a session under the next phase once the earlier one is approved", async () => {
    const engine = new PhaseEngine(store);
    expect((await engine.start(madeUp, "idea-review")).ok).toBe(true);
    await store.appendEvent({ type: "memory_updated", actor: madeUp, payload: { files: [".agents/summary.md"] } });
    const submitted = await engine.submit(madeUp, {
      phase: "idea-review",
      documents: ["docs/idea-review.md"],
      skillsUsed: [{ skill: "idea-review", evidence: "verdict section" }],
      understandingCheck: "docs/idea-review-u.md",
    });
    expect(submitted.ok).toBe(true);
    expect((await engine.approve(person, "idea-review")).ok).toBe(true);
    const started = await startSession(store, madeUp);
    if (!started.ok) throw new Error(started.message);
    const history = await phaseHistory(store);
    expect(history.find((h) => h.phase === "research")?.sessions.map((s) => s.id)).toEqual([started.sessionId]);
  });

  it("ends a session only once and refuses an id that is not a session", async () => {
    const started = await startSession(store, madeUp);
    if (!started.ok) throw new Error(started.message);
    await endSession(store, madeUp, started.sessionId);
    const before = (await store.readEvents()).events.length;
    expect(await endSession(store, madeUp, started.sessionId)).toEqual({ ok: true });
    expect((await store.readEvents()).events.length).toBe(before);

    const refused = await endSession(store, madeUp, "not-a-session");
    expect(refused.ok).toBe(false);
  });

  it("writes one end when two ends of the same session race", async () => {
    const started = await startSession(store, madeUp);
    if (!started.ok) throw new Error(started.message);
    const results = await Promise.all([endSession(store, madeUp, started.sessionId), endSession(store, madeUp, started.sessionId)]);
    expect(results).toEqual([{ ok: true }, { ok: true }]);
    const ends = (await store.readEvents()).events.filter((e) => e.type === "session_ended");
    expect(ends).toHaveLength(1);
  });

  it("removes a secret pasted into the transcript link before writing", async () => {
    const started = await startSession(store, madeUp, { transcript: "https://example.test/s?token=ghp_abcdefghijklmnopqrstuvwxyz0123456789" });
    if (!started.ok) throw new Error(started.message);
    const raw = await store.readFile("events.jsonl");
    expect(raw).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
  });
});
