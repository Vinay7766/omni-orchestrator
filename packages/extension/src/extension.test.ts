/**
 * The bundled extension, loaded the way the editor loads it (CommonJS, `vscode` provided by the
 * host), against a stand-in vscode module. Checks the wiring the unit tests cannot: the manifest's
 * commands are registered, the status bar shows the project, and it follows changes live.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryStore, PhaseEngine } from "@omni/core";
import { createNodeFs } from "@omni/core/node";

const pkgDir = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const agent = { kind: "agent" as const, tool: "made-up-agent" };

/** Just enough of the vscode API for activation, recording what the extension does. */
function fakeVscode(folder: string, approveAnswer?: string) {
  const commands = new Map<string, (...args: unknown[]) => unknown>();
  const item = { name: "", text: "", tooltip: "" as unknown, command: "" as unknown, shown: false, show() { this.shown = true; }, dispose() {} };
  const messages: string[] = [];
  return {
    answer(value: string) {
      approveAnswer = value;
    },
    commands,
    item,
    messages,
    api: {
      StatusBarAlignment: { Left: 1, Right: 2 },
      env: { appName: "Made-up Editor" },
      workspace: {
        workspaceFolders: [{ uri: { fsPath: folder } }],
        onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
      },
      window: {
        createStatusBarItem: () => item,
        showInformationMessage: async (m: string) => void messages.push(m),
        showWarningMessage: async (_m: string, options: { modal?: boolean }, ...items: string[]) =>
          options?.modal ? (approveAnswer ?? undefined) && items.find((i) => i === approveAnswer) : undefined,
        showInputBox: async () => undefined,
        showQuickPick: async () => undefined,
      },
      commands: {
        registerCommand: (id: string, fn: (...args: unknown[]) => unknown) => {
          commands.set(id, fn);
          return { dispose() {} };
        },
      },
    },
  };
}

let root: string;
beforeAll(async () => {
  execFileSync(process.execPath, [join(pkgDir, "build.mjs")], { cwd: pkgDir, stdio: "pipe" });
  root = mkdtempSync(join(tmpdir(), "omni-ext-host-")).replace(/\\/g, "/");
  const created = await MemoryStore.create(createNodeFs(), root, { name: "Orbit planner", flow: "build", mode: "full", actor: agent });
  if (!created.ok) throw new Error(JSON.stringify(created.issues));
  await new PhaseEngine(created.store).start(agent, "idea-review");
}, 120_000);
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("bundled extension", () => {
  it("declares a CommonJS entry, activation on a project, and its commands", () => {
    expect(manifest.main).toBe("./dist/extension.cjs");
    expect(manifest.activationEvents).toContain("workspaceContains:.agents/project.json");
    expect(manifest.contributes.commands.map((c: { command: string }) => c.command).sort()).toEqual([
      "omni.approvePhase",
      "omni.decidePhase",
      "omni.requestChanges",
      "omni.review",
    ]);
  });

  it("registers every command, shows the project's phase and follows changes", async () => {
    const vscode = fakeVscode(root);
    const load = (Module as unknown as { _load: (r: string, ...rest: unknown[]) => unknown })._load;
    (Module as unknown as { _load: unknown })._load = (request: string, ...rest: unknown[]) =>
      request === "vscode" ? vscode.api : load(request, ...rest);
    const ext = createRequire(import.meta.url)(join(pkgDir, "dist", "extension.cjs"));
    const context = { subscriptions: [] as { dispose(): void }[] };
    try {
      await ext.activate(context);
      for (const c of manifest.contributes.commands) expect(vscode.commands.has(c.command), c.command).toBe(true);
      expect(vscode.item.shown).toBe(true);
      expect(vscode.item.command).toBe("omni.review");
      await expect.poll(() => vscode.item.text, { timeout: 5000 }).toContain("Omni: idea-review · in progress");

      // An agent hands the phase in from another process: the status bar follows.
      const opened = await MemoryStore.open(createNodeFs(), root);
      if (!opened.ok) throw new Error("reopen");
      await opened.store.appendEvent({ type: "memory_updated", actor: agent, payload: { files: [".agents/summary.md"] } });
      await new PhaseEngine(opened.store).submit(agent, { phase: "idea-review", documents: ["a.md"], skillsUsed: [{ skill: "x", evidence: "y" }], understandingCheck: "u.md" });
      await expect.poll(() => vscode.item.text, { timeout: 5000 }).toContain("review needed");

      // The person approves in the editor: recorded as a person, named by the editor, and the
      // next phase starts; the status bar follows.
      vscode.answer("Approve");
      await vscode.commands.get("omni.approvePhase")!();
      const events = (await opened.store.readEvents()).events.slice(-2);
      expect(events.map((e) => e.type)).toEqual(["phase_approved", "phase_started"]);
      for (const e of events) expect(e.actor).toEqual({ kind: "human", tool: "Made-up Editor" });
      await expect.poll(() => vscode.item.text, { timeout: 5000 }).toContain("Omni: research · in progress");
    } finally {
      for (const d of context.subscriptions) d.dispose();
      ext.deactivate?.();
      (Module as unknown as { _load: unknown })._load = load;
    }
  }, 30_000);
});
