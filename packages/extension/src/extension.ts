/**
 * The editor layer: status bar and commands, wired to the plain modules (gate.ts, status.ts).
 * API per @types/vscode 1.90 (engines ^1.90.0), so editors built on older VS Code versions load it.
 */
import * as vscode from "vscode";
import { endSession, findProject, joinPath, MEMORY_DIR, MemoryStore, normalizePath, startSession, watchEvents, type EventWatch } from "@omni/core";
import { createFileTrust, createNodeChangeTrigger, createNodeFs } from "@omni/core/node";
import { approvePhase, decideOptionalPhase, requestChanges, type GateUi } from "./gate.js";
import { idleStatusText, statusText } from "./status.js";
import { startNextPhaseInChat, type ChatHost } from "./chat.js";

const fs = createNodeFs();

let store: MemoryStore | null = null;
let watch: EventWatch | null = null;
/** This editor window's session in the open project (HND-8), ended when the project closes. */
let session: { store: MemoryStore; id: string } | null = null;

/** The person at this editor. The editor's own name, whatever fork it is. */
const person = () => ({ kind: "human" as const, tool: vscode.env.appName || "editor" });

const ui: GateUi = {
  // A modal the person has to click: an agent running editor commands cannot answer it.
  confirm: async (message, detail) => (await vscode.window.showWarningMessage(message, { modal: true, detail }, "Approve")) === "Approve",
  askNotes: (phase) =>
    Promise.resolve(
      vscode.window.showInputBox({
        title: `Request changes to "${phase}"`,
        prompt: "What should change? The AI tool working on the project reads these notes.",
        ignoreFocusOut: true,
      }),
    ),
  // Modal too: the person, not an agent, decides whether an optional phase runs (SEC-1).
  choose: (message, detail, options) => Promise.resolve(vscode.window.showWarningMessage(message, { modal: true, detail }, ...options)),
  show: (message) => void vscode.window.showInformationMessage(message),
};

const chatHost: ChatHost = {
  execute: (command, arg) => Promise.resolve(vscode.commands.executeCommand(command, arg)),
  copy: (text) => Promise.resolve(vscode.env.clipboard.writeText(text)),
  show: (message) => void vscode.window.showInformationMessage(message),
};

const START_IN_CHAT = "Start it in a fresh chat";

/** After an approval, offers to start the next phase in a fresh chat here (E, HND-7). */
async function offerFreshChat(s: MemoryStore): Promise<void> {
  const state = await s.readState();
  const phase = state.currentPhase;
  if (!phase || state.phases[phase]?.status !== "in_progress") return;
  const choice = await vscode.window.showInformationMessage(`"${phase}" is next. Start it in a fresh chat, so it does not carry the long conversation before it?`, START_IN_CHAT);
  if (choice === START_IN_CHAT) await startNextPhaseInChat(s, chatHost);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const item = vscode.window.createStatusBarItem("omni.status", vscode.StatusBarAlignment.Left, 100);
  item.name = "OmniOrchestrator";
  item.command = "omni.review";
  item.text = `$(checklist) ${idleStatusText()}`;
  item.show();

  const withStore = (run: (s: MemoryStore) => Promise<void>) => async () => {
    if (!store) {
      void vscode.window.showInformationMessage("No OmniOrchestrator project is open in this window.");
      return;
    }
    await run(store);
  };

  context.subscriptions.push(
    item,
    vscode.commands.registerCommand(
      "omni.approvePhase",
      withStore(async (s) => {
        await approvePhase(s, person(), ui);
        await offerFreshChat(s);
      }),
    ),
    vscode.commands.registerCommand("omni.startNextPhaseInChat", withStore((s) => startNextPhaseInChat(s, chatHost).then(() => undefined))),
    vscode.commands.registerCommand("omni.requestChanges", withStore((s) => requestChanges(s, person(), ui))),
    vscode.commands.registerCommand("omni.decidePhase", withStore((s) => decideOptionalPhase(s, person(), ui))),
    vscode.commands.registerCommand(
      "omni.review",
      withStore(async (s) => {
        const state = await s.readState();
        const phase = state.currentPhase;
        if (!phase || state.phases[phase]?.status !== "awaiting_review") {
          void vscode.window.showInformationMessage(`${statusText(state)}. Nothing is waiting for review.`);
          return;
        }
        const choice = await vscode.window.showQuickPick(["Approve", "Request changes"], { title: `Review "${phase}"` });
        if (choice === "Approve") {
          await approvePhase(s, person(), ui);
          await offerFreshChat(s);
        }
        if (choice === "Request changes") await requestChanges(s, person(), ui);
      }),
    ),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void openProject(item)),
    { dispose: () => void stopWatching() },
  );
  await openProject(item);
}

export function deactivate(): Promise<void> {
  return stopWatching();
}

/** Stops following the project and records the end of this window's session in it. */
async function stopWatching(): Promise<void> {
  watch?.stop();
  watch = null;
  store = null;
  const ending = session;
  session = null;
  if (!ending) return;
  const ended = await endSession(ending.store, person(), ending.id).catch((e: unknown) => ({ ok: false as const, message: String(e) }));
  if (!ended.ok) console.error("OmniOrchestrator: the session end could not be recorded:", ended.message);
}

/** The first workspace folder inside an OmniOrchestrator project; the status bar follows it live. */
async function openProject(item: vscode.StatusBarItem): Promise<void> {
  await stopWatching();
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const found = await findProject(fs, normalizePath(folder.uri.fsPath));
    if (!found.ok) continue;
    // A person's decision counts only when signed by the desktop app (C17).
    const opened = await MemoryStore.open(fs, found.root, { trust: createFileTrust() });
    if (!opened.ok) continue;
    store = opened.store;
    const project = store.readProject();
    item.tooltip = `OmniOrchestrator: ${project.name} (${found.root})`;
    // The person's editor session in this project. The editor's AI chats are not visible to an
    // extension, so this records the window, named by the editor, not a particular chat.
    const started = await startSession(store, person());
    if (started.ok) session = { store, id: started.sessionId };
    else console.error("OmniOrchestrator: the session could not be recorded:", started.message);
    watch = watchEvents(
      store.follow(),
      createNodeChangeTrigger(joinPath(found.root, MEMORY_DIR)),
      (update) => {
        item.text = `$(checklist) ${statusText(update.state)}`;
      },
      { onError: (error) => console.error("OmniOrchestrator: could not read project memory:", error) },
    );
    await watch.ready;
    return;
  }
  item.text = `$(checklist) ${idleStatusText()}`;
  item.tooltip = "Open a folder that contains an OmniOrchestrator project (.agents/project.json).";
}
