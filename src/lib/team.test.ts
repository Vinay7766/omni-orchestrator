// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore, PhaseEngine, TaskEngine, type Invoke } from "@omni/core";
import { createNodeFs } from "@omni/core/node";
import { handOffTool, loadTeam, saveTeamSelection } from "./team";
import { DESKTOP_PERSON } from "./decisions";
import { fakeInvoke } from "./testing/fake-invoke";

// E6 slice 4: the person's tool selection is saved, and each selected tool is handed the build:
// the AGENTS.md text goes to the Rust command, chat-only tools get the package in .agents/.

const node = createNodeFs();
const agent = { kind: "agent" as const, tool: "omni-desktop", model: "made-up-model" };
const editor = { toolId: "example-editor", name: "Example Editor", capability: 3 as const, confirmedByPerson: false };
const chat = { toolId: "chat-site", name: "Chat Site", capability: 1 as const, confirmedByPerson: true };
const handoffResult = { toolId: "example-editor", level: 3, files: ["AGENTS.md created."], mcp: null, mcpProblem: null, launched: true, message: "Example Editor was opened with the project." };

let base: string;
let root: string;
let calls: { command: string; args: Record<string, unknown> }[];
let invoke: Invoke;

const open = async () => {
  const opened = await MemoryStore.open(node, root);
  if (!opened.ok) throw new Error(JSON.stringify(opened.issues));
  return opened.store;
};

/** A project with planning approved, one task, and the build phase started or not. */
async function project(buildStarted: boolean) {
  const created = await MemoryStore.create(node, root, { name: "Orbit", flow: "build", mode: "full", actor: DESKTOP_PERSON });
  if (!created.ok) throw new Error(JSON.stringify(created.issues));
  const store = created.store;
  const engine = new PhaseEngine(store);
  for (const phase of ["idea-review", "research", "prd", "architecture"]) {
    await engine.start(agent, phase);
    await store.appendEvent({ type: "memory_updated", actor: agent, payload: { files: [".agents/project.json"] } });
    await engine.submit(agent, {
      phase,
      documents: [".agents/project.json"],
      skillsUsed: [{ skill: "x", evidence: "y" }],
      understandingCheck: ".agents/project.json",
      ...(phase === "architecture" ? { stackAdr: ".agents/project.json" } : {}),
    });
    await engine.approve(DESKTOP_PERSON, phase);
  }
  if (buildStarted) await engine.start(DESKTOP_PERSON, "build");
  await new TaskEngine(store).create(agent, { taskId: "T-1", title: "Shopping list data model", kinds: ["backend"] });
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "omni-app-team-")).replace(/\\/g, "/");
  root = `${base}/orbit`;
  calls = [];
  const files = fakeInvoke();
  invoke = (command, args) => {
    calls.push({ command, args: args as Record<string, unknown> });
    if (command === "hand_off_tool") return Promise.resolve(handoffResult);
    return files(command, args);
  };
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe("team (app)", () => {
  it("has no team until the person saves one, then reads it back", async () => {
    await project(true);
    expect(await loadTeam(invoke, root)).toEqual({ ok: true, team: null });
    const saved = await saveTeamSelection(invoke, root, [editor, chat]);
    expect(saved).toMatchObject({ ok: true });
    const read = await loadTeam(invoke, root);
    expect(read.ok && read.team?.members.map((m) => m.toolId)).toEqual(["example-editor", "chat-site"]);
    const last = (await (await open()).readEvents()).events.at(-1)!;
    expect(last.actor).toEqual(DESKTOP_PERSON);
  });

  it("sends the AGENTS.md text naming the next task to the handoff command", async () => {
    await project(true);
    await saveTeamSelection(invoke, root, [editor]);
    const r = await handOffTool(invoke, root, "example-editor");
    expect(r).toMatchObject({ ok: true, result: { launched: true } });
    const sent = calls.find((c) => c.command === "hand_off_tool")!.args.request as { projectPath: string; toolId: string; agentsBlock: string };
    expect(sent.projectPath).toBe(root);
    expect(sent.toolId).toBe("example-editor");
    expect(sent.agentsBlock).toContain("T-1: Shopping list data model");
  });

  it("returns the step-by-step guide for the tool, naming the model its next task asks for (D)", async () => {
    await project(true);
    const store = await open();
    await new TaskEngine(store).create(agent, { taskId: "T-2", title: "List screen", kinds: ["interface"], assignedTool: "example-editor", assignedModel: "made-up-large", assignmentReason: "r" });
    await saveTeamSelection(invoke, root, [{ ...editor, models: ["made-up-large"] }]);
    const r = await handOffTool(invoke, root, "example-editor");
    expect(r.ok && r.steps?.join(" ")).toContain("made-up-large");
    expect(r.ok && r.steps?.join(" ")).toMatch(/get_context/);
    const sent = calls.find((c) => c.command === "hand_off_tool")!.args.request as { agentsBlock: string };
    expect(sent.agentsBlock).toContain("T-2: List screen");
  });

  it("saves the handoff package for a chat-only tool and returns it to show", async () => {
    await project(true);
    await saveTeamSelection(invoke, root, [chat]);
    const r = await handOffTool(invoke, root, "chat-site");
    expect(r.ok && r.handoffPackage).toContain("T-1: Shopping list data model");
    expect(readFileSync(`${root}/.agents/handoff/latest.md`, "utf8")).toContain("T-1: Shopping list data model");
  });

  it("starts the build phase as the person on the first handoff, and only then", async () => {
    await project(false);
    await saveTeamSelection(invoke, root, [editor]);
    await handOffTool(invoke, root, "example-editor");
    const store = await open();
    expect((await store.readState()).phases.build?.status).toBe("in_progress");
    const started = (await store.readEvents()).events.filter((e) => e.type === "phase_started" && (e.payload as { phase: string }).phase === "build");
    expect(started).toHaveLength(1);
    expect(started[0].actor).toEqual(DESKTOP_PERSON);
    await handOffTool(invoke, root, "example-editor");
    const again = (await (await open()).readEvents()).events.filter((e) => e.type === "phase_started" && (e.payload as { phase: string }).phase === "build");
    expect(again).toHaveLength(1);
  });

  it("refuses a tool that is not in the saved team, without calling the command", async () => {
    await project(true);
    await saveTeamSelection(invoke, root, [editor]);
    const r = await handOffTool(invoke, root, "chat-site");
    expect(r).toMatchObject({ ok: false });
    expect(calls.some((c) => c.command === "hand_off_tool")).toBe(false);
  });

  it("returns the command's refusal as the real reason and does not start the build", async () => {
    await project(false);
    await saveTeamSelection(invoke, root, [editor]);
    const files = fakeInvoke();
    const refusing: Invoke = (command, args) =>
      command === "hand_off_tool" ? Promise.reject("AGENTS.md is a link to another file, so it was not changed.") : files(command, args);
    const r = await handOffTool(refusing, root, "example-editor");
    expect(r).toEqual({ ok: false, error: "AGENTS.md is a link to another file, so it was not changed." });
    expect((await (await open()).readState()).phases.build?.status ?? "not_started").toBe("not_started");
  });
});
