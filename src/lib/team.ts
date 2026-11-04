/**
 * Tools for the build (E6, TOOL-2, PLAN-3): the person selects which discovered tools to use for
 * a project (saved in .agents/team.json through core, recorded as their decision) and hands the
 * build to each one. The handoff text is built by core; the Rust command checks it, writes the
 * tool's files and starts the tool. Chat-only tools get the package saved in .agents/handoff/.
 */
import {
  buildHandoff,
  createInvokeFs,
  HANDOFF_FILE,
  MemoryStore,
  normalizePath,
  PhaseEngine,
  readTeam,
  saveTeam,
  type Invoke,
  type Team,
  type TeamSelection,
  startSteps,
} from "@omni/core";
import { DESKTOP_PERSON } from "./decisions";
import type { DiscoveredTool, HandoffResult } from "./types";

type Failure = { ok: false; error: string };
export type HandOffOutcome =
  | {
      ok: true;
      result: HandoffResult;
      handoffPackage?: string;
      buildStarted: boolean;
      buildProblem?: string;
      /** How the person starts work in this tool, step by step (D). */
      steps?: string[];
    }
  | Failure;

const reason = (error: unknown) => (error instanceof Error ? error.message : typeof error === "string" ? error : String(error));

async function openStore(invoke: Invoke, root: string) {
  const opened = await MemoryStore.open(createInvokeFs(invoke), root);
  if (!opened.ok) throw new Error(opened.issues.map((i) => `${i.path} ${i.message}`.trim()).join("; "));
  return opened.store;
}

type Discovery = { ok: true; tools: DiscoveredTool[] } | Failure;

/** The last successful look for tools in this app run (owner's v0.1 issue A: looking is slow). */
let found: Promise<Discovery> | null = null;

/** Forgets the remembered result (tests, and "look again"). */
export function forgetDiscovery(): void {
  found = null;
}

/**
 * Every AI tool found on this computer (Rust discovery). Looked for once per app run and reused,
 * so opening or refreshing a page does not scan again; `fresh` looks again on the person's request.
 */
export function discoverTools(invoke: Invoke, options: { fresh?: boolean } = {}): Promise<Discovery> {
  if (options.fresh || !found) {
    const look: Promise<Discovery> = (async () => {
      try {
        return { ok: true as const, tools: (await invoke("discover_tools", {})) as DiscoveredTool[] };
      } catch (error) {
        return { ok: false as const, error: reason(error) };
      }
    })();
    found = look;
    // A failed look is not remembered, so the next one tries again.
    void look.then((r) => {
      if (!r.ok && found === look) found = null;
    });
  }
  return found;
}

export async function loadTeam(invoke: Invoke, rootIn: string): Promise<{ ok: true; team: Team | null } | Failure> {
  try {
    const read = await readTeam(await openStore(invoke, normalizePath(rootIn)));
    return read.ok ? read : { ok: false, error: read.message };
  } catch (error) {
    return { ok: false, error: reason(error) };
  }
}

export async function saveTeamSelection(invoke: Invoke, rootIn: string, selection: TeamSelection[]): Promise<{ ok: boolean; message: string }> {
  const root = normalizePath(rootIn);
  try {
    const saved = await saveTeam({ store: await openStore(invoke, root), fs: createInvokeFs(invoke), root }, DESKTOP_PERSON, selection);
    if (!saved.ok) return { ok: false, message: saved.message };
    const count = saved.team.members.length;
    return { ok: true, message: count === 0 ? "No tools are selected for this project." : `${count} tool${count === 1 ? "" : "s"} selected for this project.` };
  } catch (error) {
    return { ok: false, message: reason(error) };
  }
}

/** Hands the build to one selected tool; the build phase starts (as the person) on the first one. */
export async function handOffTool(invoke: Invoke, rootIn: string, toolId: string): Promise<HandOffOutcome> {
  const root = normalizePath(rootIn);
  try {
    const store = await openStore(invoke, root);
    const team = await readTeam(store);
    if (!team.ok) return { ok: false, error: team.message };
    const member = team.team?.members.find((m) => m.toolId === toolId);
    if (!member) return { ok: false, error: `"${toolId}" is not one of the tools selected for this project. Select it and save first.` };

    const state = await store.readState();
    const handoff = buildHandoff({
      projectName: store.readProject().name,
      state,
      summary: await store.readFile("summary.md"),
      team: team.team?.members ?? [],
      toolId,
    });
    const model = handoff.nextTask?.assignedModel ?? member.models?.[0];
    const steps = startSteps(member.capability as 1 | 2 | 3, member.name, model);
    if (member.capability === 1) await store.writeFile(HANDOFF_FILE, handoff.package);
    const result = (await invoke("hand_off_tool", {
      request: { projectPath: root, toolId, agentsBlock: handoff.agentsBlock },
    })) as HandoffResult;

    let buildStarted = false;
    let buildProblem: string | undefined;
    const build = state.phases.build?.status ?? "not_started";
    if (build === "not_started") {
      const started = await new PhaseEngine(store).start(DESKTOP_PERSON, "build");
      buildStarted = started.ok;
      if (!started.ok) buildProblem = `The build phase could not be started: ${started.issues.map((i) => i.message).join("; ")}`;
    }
    return {
      ok: true,
      result,
      buildStarted,
      steps,
      ...(buildProblem ? { buildProblem } : {}),
      ...(member.capability === 1 ? { handoffPackage: handoff.package } : {}),
    };
  } catch (error) {
    return { ok: false, error: reason(error) };
  }
}
