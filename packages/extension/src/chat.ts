/**
 * E (tester feedback 6, HND-7): the next phase starts in a fresh chat inside the editor. The prompt
 * comes from project memory only (core's buildFreshSession) and is saved to
 * .agents/handoff/next-session.md. It is put in the editor's chat box, not sent: the person reads
 * it and presses Enter (one click, as HND-7 asks for GUI tools).
 *
 * Commands checked against VS Code's own source (src/vs/workbench/contrib/chat/browser/actions/
 * chatActions.ts, 2026-11-03): `workbench.action.chat.newChat` starts a new chat;
 * `workbench.action.chat.open` takes `{ query, isPartialQuery }`, and with isPartialQuery the text
 * goes in the input without being sent. Editors without them get the prompt on the clipboard.
 */
import { buildFreshSession, FRESH_SESSION_FILE, type MemoryStore, type State } from "@omni/core";

export const NEW_CHAT = "workbench.action.chat.newChat";
export const OPEN_CHAT = "workbench.action.chat.open";

/** What the editor offers this module; the vscode layer supplies it, tests supply fakes. */
export interface ChatHost {
  execute(command: string, arg?: unknown): Promise<unknown>;
  copy(text: string): Promise<void>;
  show(message: string): void;
}

export async function startNextPhaseInChat(store: MemoryStore, host: ChatHost, over: { state?: State } = {}): Promise<"chat" | "copied" | "none"> {
  const project = store.readProject();
  const { phase, prompt } = buildFreshSession({ projectName: project.name, flow: project.flow, state: over.state ?? (await store.readState()) });
  if (!phase) {
    host.show("Every phase is done. There is no next phase to start.");
    return "none";
  }
  await store.writeFile(FRESH_SESSION_FILE, prompt);
  try {
    // A new chat first, so the phase starts without the long conversation before it. Some
    // editors have no such command; the prompt still goes in the open chat then.
    await host.execute(NEW_CHAT).catch(() => undefined);
    await host.execute(OPEN_CHAT, { query: prompt, isPartialQuery: true });
    host.show(`The prompt for "${phase}" is in a new chat. Read it, choose your model, and press Enter to start.`);
    return "chat";
  } catch {
    await host.copy(prompt);
    host.show(`This editor has no chat command OmniOrchestrator can use, so the prompt for "${phase}" was copied. Open your AI chat, start a new chat and paste it.`);
    return "copied";
  }
}
