/**
 * Owner's v0.1 issue C (2026-11-04): when every task is done but no tool handed in the build, the
 * build stayed "in progress" and the review phase never became next. The person can hand it in:
 * recorded as the person, with the files and the skill evidence the finished tasks recorded (no
 * new claims). The gate rules (memory update, evidence) are core's, unchanged.
 */
import { createInvokeFs, MemoryStore, normalizePath, PhaseEngine, type Invoke } from "@omni/core";
import { DESKTOP_PERSON } from "./decisions";

export async function handInBuild(invoke: Invoke, rootIn: string): Promise<{ ok: boolean; message: string }> {
  try {
    const opened = await MemoryStore.open(createInvokeFs(invoke), normalizePath(rootIn));
    if (!opened.ok) return { ok: false, message: opened.issues.map((i) => i.message).join("; ") };
    const store = opened.store;
    const state = await store.readState();
    const open = state.tasks.filter((t) => t.status !== "done").map((t) => t.id);
    if (state.tasks.length === 0) return { ok: false, message: "There are no tasks yet." };
    if (open.length > 0) return { ok: false, message: `Not every task is done yet: ${open.join(", ")}.` };

    const completed = (await store.readEvents()).events.filter((e) => e.type === "task_completed");
    const documents = [...new Set(completed.flatMap((e) => e.refs?.files ?? []))];
    const skills = new Map<string, string[]>();
    for (const e of completed) {
      const p = e.payload as { taskId?: string; skillsUsed?: { skill: string; evidence: string }[] };
      for (const s of p.skillsUsed ?? []) skills.set(s.skill, [...(skills.get(s.skill) ?? []), `${p.taskId}: ${s.evidence}`]);
    }
    if (documents.length === 0) return { ok: false, message: "The finished tasks recorded no files, so there is nothing to hand in for review." };

    const r = await new PhaseEngine(store).submit(DESKTOP_PERSON, {
      phase: "build",
      documents,
      skillsUsed: [...skills].map(([skill, evidence]) => ({ skill, evidence: evidence.join("; ").slice(0, 2000) })),
    });
    return r.ok
      ? { ok: true, message: "The build is handed in for your review. Approve it to start the review phase." }
      : { ok: false, message: r.issues.map((i) => i.message).join("; ") };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
