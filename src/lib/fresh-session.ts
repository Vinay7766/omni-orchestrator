/**
 * The next phase in a fresh session (E11, HND-7). The prompt is built by core from memory alone;
 * the Rust command saves it in .agents/handoff/ and starts the tool. The new session is recorded
 * in the session tree (HND-8) here, unless the tool is connected over MCP, whose server records
 * the session itself when the tool connects.
 */
import { buildFreshSession, createInvokeFs, MemoryStore, normalizePath, readTeam, startSession, type Invoke, desktopStoreOptions } from "@omni/core";

export interface FreshSessionResult {
  toolId: string;
  toolName: string;
  launched: boolean;
  /** The tool was given the prompt; when false, the person pastes it. */
  promptPassed: boolean;
  message: string;
}

export type FreshSessionOutcome =
  | { ok: true; result: FreshSessionResult; prompt: string; sessionRecorded: boolean; sessionProblem?: string }
  | { ok: false; error: string };

const reason = (error: unknown) => (error instanceof Error ? error.message : typeof error === "string" ? error : String(error));

export async function startFreshSession(invoke: Invoke, rootIn: string, toolId: string): Promise<FreshSessionOutcome> {
  const root = normalizePath(rootIn);
  try {
    const opened = await MemoryStore.open(createInvokeFs(invoke), root, desktopStoreOptions(invoke));
    if (!opened.ok) return { ok: false, error: opened.issues.map((i) => `${i.path} ${i.message}`.trim()).join("; ") };
    const store = opened.store;
    const team = await readTeam(store);
    if (!team.ok) return { ok: false, error: team.message };
    const member = team.team?.members.find((m) => m.toolId === toolId);
    if (!member) return { ok: false, error: `"${toolId}" is not one of the tools selected for this project. Select it first.` };

    const project = store.readProject();
    const { prompt } = buildFreshSession({ projectName: project.name, flow: project.flow, state: await store.readState() });
    const result = (await invoke("start_fresh_session_cmd", { request: { projectPath: root, toolId, prompt } })) as FreshSessionResult;

    if (!result.launched || member.capability === 3) return { ok: true, result, prompt, sessionRecorded: false };
    const session = await startSession(store, { kind: "agent", tool: result.toolName || member.name });
    return session.ok
      ? { ok: true, result, prompt, sessionRecorded: true }
      : { ok: true, result, prompt, sessionRecorded: false, sessionProblem: `The session could not be recorded: ${session.message}` };
  } catch (error) {
    return { ok: false, error: reason(error) };
  }
}
