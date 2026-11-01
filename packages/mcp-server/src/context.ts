/**
 * get_context (ARCHITECTURE 5; MEM-2, SKL-2): everything an AI tool needs to continue a
 * project, in one read. All rules live in @omni/core; this only gathers and shapes.
 */
import {
  findProject,
  joinPath,
  MemoryStore,
  renderSummary,
  resolvePhaseSkills,
  validateMemoryFile,
  type Event,
  type MemoryFs,
  type SkillSource,
  type State,
} from "@omni/core";

export interface ContextDeps {
  fs: MemoryFs;
  skills: SkillSource;
  /** Where the server was started; the default place to look for the project. */
  startDir: string;
}

type Task = State["tasks"][number];

export interface ProjectContext {
  project: { id: string; name: string; flow: string; mode: string; root: string; linkedFrom?: string };
  phase: { id: string | null; status: string | null };
  tasks: { inProgress: Task[]; next: Task | null; done: number; total: number };
  summary: string;
  recentDecisions: { title: string; decision: string; reason: string; time: string }[];
  lessons: string[];
  skills: { id: string; name: string; description: string; reason: "phase" | "all-phases" }[];
  warnings: string[];
}

export type ContextResult = { ok: true; context: ProjectContext } | { ok: false; message: string };

const RECENT_DECISIONS = 5;

const payload = (e: Event) => e.payload as Record<string, unknown>;
const text = (value: unknown) => (typeof value === "string" ? value : "");

export async function buildContext(deps: ContextDeps, input: { projectPath?: string }): Promise<ContextResult> {
  const startDir = input.projectPath ? joinPath(deps.startDir, input.projectPath) : deps.startDir;
  const found = await findProject(deps.fs, startDir);
  if (!found.ok) {
    return {
      ok: false,
      message: `${found.issues.map((i) => i.message).join("; ")}. Create a project in the OmniOrchestrator app, or pass projectPath with the project's folder.`,
    };
  }
  const opened = await MemoryStore.open(deps.fs, found.root);
  if (!opened.ok) return { ok: false, message: opened.issues.map((i) => `${i.path} ${i.message}`.trim()).join("; ") };
  const store = opened.store;

  const project = store.readProject();
  const state = await store.readState();
  const { events, issues } = await store.readEvents();
  const warnings: string[] = issues.map((i) => `events.jsonl line ${i.line}: ${i.message}`);

  const phaseId = state.currentPhase;
  const skills = phaseId === null ? [] : await phaseSkills(deps.skills, store, phaseId, warnings);
  if (phaseId === null) warnings.push("No phase has started yet; skills are served once a phase starts.");

  const decisions = events.filter((e) => e.type === "decision_recorded").slice(-RECENT_DECISIONS).reverse();
  return {
    ok: true,
    context: {
      project: {
        id: project.id,
        name: project.name,
        flow: project.flow,
        mode: project.mode,
        root: found.root,
        ...(found.linkedFrom ? { linkedFrom: found.linkedFrom } : {}),
      },
      phase: { id: phaseId, status: phaseId === null ? null : (state.phases[phaseId]?.status ?? null) },
      tasks: {
        inProgress: state.tasks.filter((t) => t.status === "in_progress"),
        next: state.tasks.find((t) => t.status === "todo" || t.status === "designed") ?? null,
        done: state.tasks.filter((t) => t.status === "done").length,
        total: state.tasks.length,
      },
      summary: (await store.readFile("summary.md")) ?? renderSummary(project, state, events),
      recentDecisions: decisions.map((e) => ({
        title: text(payload(e).title),
        decision: text(payload(e).decision),
        reason: text(payload(e).reason),
        time: e.time,
      })),
      lessons: events.filter((e) => e.type === "lesson_recorded").map((e) => text(payload(e).lesson)),
      skills,
      warnings,
    },
  };
}

async function phaseSkills(source: SkillSource, store: MemoryStore, phase: string, warnings: string[]) {
  const catalog = await source.list();
  if (!catalog.ok) {
    warnings.push(`Skill catalog could not be read: ${catalog.issues.map((i) => i.message).join("; ")}`);
    return [];
  }
  const resolved = resolvePhaseSkills(catalog.entries, await readOverrides(store, warnings), phase);
  warnings.push(...resolved.warnings);
  return resolved.skills.map(({ id, name, description, reason }) => ({ id, name, description, reason }));
}

async function readOverrides(store: MemoryStore, warnings: string[]) {
  const raw = await store.readFile("skills.json");
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    warnings.push("skills.json is not valid JSON; the catalog's default skills are used.");
    return null;
  }
  const valid = validateMemoryFile("skills-config", parsed);
  if (!valid.ok) {
    warnings.push(`skills.json is invalid (${valid.issues.map((i) => `${i.path} ${i.message}`).join("; ")}); the catalog's default skills are used.`);
    return null;
  }
  return valid.value;
}
