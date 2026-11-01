import { MEMORY_DIR } from "../constants.js";
import type { Event, Project, State } from "../generated/types.js";
import { redactJson, redactText } from "../redact.js";
import { validateMemoryFile, type ValidationIssue } from "../validate.js";
import type { MemoryFs } from "./fs.js";
import { applyEvent, initialState, rebuild } from "./reduce.js";
import { parentDir } from "./paths.js";
import * as generated from "../generated/validators.js";

// The schema's own rule for a relative path that cannot escape its base folder.
const isMemoryRelativePath = generated.commonRelPath as unknown as (value: unknown) => boolean;

export interface StoreOptions {
  /** How long to wait for another writer's lock before giving up (default 10 s). */
  lockTimeoutMs?: number;
  /** A lock older than this is treated as left by a crashed writer (default 30 s). */
  staleLockMs?: number;
}

export type StoreResult = { ok: true; store: MemoryStore } | { ok: false; issues: ValidationIssue[] };

/** What a caller provides; id, time and formatVersion are added by the store. */
export interface EventInput {
  type: Event["type"];
  actor: Event["actor"];
  payload: Record<string, unknown>;
  refs?: Event["refs"];
}

export type AppendResult =
  | { ok: true; event: Event; /** Number of secrets removed before writing. */ redactions: number }
  | { ok: false; issues: ValidationIssue[] };

/** A rule evaluated inside the store's lock; returning issues prevents the write. */
export type EventGuard = (state: State, events: Event[]) => ValidationIssue[];

export interface LineIssue {
  line: number;
  message: string;
}

class LockTimeout extends Error {}

let idCounter = 0;
function newId(prefix: string): string {
  idCounter = (idCounter + 1) % 1_679_616; // stays within 4 base-36 digits
  const random = Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, "0");
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36).padStart(4, "0")}-${random}`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const issue = (message: string, path = ""): ValidationIssue => ({ path, message });

/**
 * One project's memory folder. The append-only events.jsonl is the source of truth;
 * state.json is a snapshot kept in step with it and rebuilt from it when needed.
 */
export class MemoryStore {
  private constructor(
    private readonly fs: MemoryFs,
    readonly dir: string,
    private readonly project: Project,
    private readonly options: Required<StoreOptions>,
  ) {}

  private path(name: string): string {
    return `${this.dir}/${name}`;
  }

  /** Creates .agents/ in `root` and records project_created. Refuses if a project exists. */
  static async create(
    fs: MemoryFs,
    root: string,
    init: { name: string; flow: Project["flow"]; mode: Project["mode"]; actor: Event["actor"] },
    options: StoreOptions = {},
  ): Promise<StoreResult> {
    const dir = `${root}/${MEMORY_DIR}`;
    const project: Project = {
      formatVersion: 1,
      id: newId("proj"),
      name: redactText(init.name).text,
      createdAt: new Date().toISOString(),
      mode: init.mode,
      flow: init.flow,
    };
    const valid = validateMemoryFile("project", project);
    if (!valid.ok) return valid;

    await fs.mkdir(dir);
    // Exclusive create is the claim: two tools creating at once cannot both succeed.
    if (!(await fs.createExclusive(`${dir}/project.json`, JSON.stringify(project, null, 2) + "\n"))) {
      return { ok: false, issues: [issue(`a project already exists in ${dir}`)] };
    }
    const store = new MemoryStore(fs, dir, project, withDefaults(options));
    const created = await store.appendEvent({
      type: "project_created",
      actor: init.actor,
      payload: { name: project.name, flow: project.flow },
    });
    return created.ok ? { ok: true, store } : created;
  }

  /** Opens an existing project; rebuilds state.json if it is missing or invalid. */
  static async open(fs: MemoryFs, root: string, options: StoreOptions = {}): Promise<StoreResult> {
    const dir = `${root}/${MEMORY_DIR}`;
    const text = await fs.readText(`${dir}/project.json`);
    if (text === null) return { ok: false, issues: [issue(`no project found in ${dir}`)] };
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, issues: [issue("project.json is not valid JSON")] };
    }
    const project = validateMemoryFile("project", parsed);
    if (!project.ok) return project;

    const store = new MemoryStore(fs, dir, project.value, withDefaults(options));
    const needsRebuild = (await store.readStoredState()) === null;
    try {
      await store.withLock(async () => {
        await store.removeCrashLeftovers();
        if (needsRebuild) await store.writeState(await store.rebuildState());
      });
    } catch (error) {
      // Cleanup is best effort; only a needed rebuild makes a busy lock fatal.
      if (needsRebuild) return { ok: false, issues: [issue(String(error instanceof Error ? error.message : error))] };
    }
    return { ok: true, store };
  }

  /**
   * Removes state temp files left by a crash between writing and renaming. Safe only under the
   * lock, because state is only ever written under the lock. Temp files from writeFile
   * (".write.*") are left alone: document refreshes run outside the lock and may be mid-write.
   */
  private async removeCrashLeftovers(): Promise<void> {
    for (const name of await this.fs.list(this.dir)) {
      if (/^\.state\.tmp-[^/\\]+\.json$/.test(name)) await this.fs.remove(this.path(name));
    }
  }

  /** Redacts, validates and appends one event, keeping state.json in step. */
  /**
   * @param guard optional rule check run inside the lock against the current state and
   *   events; if it returns issues nothing is written. Use it for any "only if" rule so the
   *   check and the write are one atomic step (no check-then-act race between tools).
   * @param effect optional work (for example writing a design note) run inside the lock after
   *   the guard passes and before the event is appended. If it throws, the event is not written.
   */
  async appendEvent(input: EventInput, guard?: EventGuard, effect?: () => Promise<void>): Promise<AppendResult> {
    const { value: clean, findings } = redactJson({ payload: input.payload, refs: input.refs });
    const event: Event = {
      formatVersion: 1,
      id: newId("evt"),
      time: new Date().toISOString(),
      type: input.type,
      actor: input.actor,
      payload: clean.payload,
      ...(clean.refs ? { refs: clean.refs } : {}),
    };
    const valid = validateMemoryFile("event", event);
    if (!valid.ok) return valid;

    try {
      return await this.withLock(async () => {
        const state = (await this.readStoredState()) ?? (await this.rebuildState());
        if (guard) {
          const problems = guard(state, (await this.readEvents()).events);
          if (problems.length > 0) return { ok: false as const, issues: problems };
        }
        const next = applyEvent(state, event);
        const checked = validateMemoryFile("state", next);
        if (!checked.ok) return { ok: false as const, issues: checked.issues };
        if (effect) {
          try {
            await effect();
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            return { ok: false as const, issues: [issue(`could not complete the change, nothing was recorded: ${reason}`)] };
          }
        }
        await this.fs.appendText(this.path("events.jsonl"), JSON.stringify(event) + "\n");
        await this.writeState(next);
        return { ok: true as const, event, redactions: findings.length };
      });
    } catch (error) {
      if (error instanceof LockTimeout) return { ok: false, issues: [issue(error.message)] };
      throw error;
    }
  }

  /** The project's identity and settings (project.json). */
  readProject(): Project {
    return this.project;
  }

  /** Every valid event in order; broken or invalid lines are reported, not fatal. */
  async readEvents(): Promise<{ events: Event[]; issues: LineIssue[] }> {
    const text = (await this.fs.readText(this.path("events.jsonl"))) ?? "";
    const events: Event[] = [];
    const issues: LineIssue[] = [];
    text.split("\n").forEach((raw, index) => {
      if (raw.trim() === "") return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        issues.push({ line: index + 1, message: "not valid JSON" });
        return;
      }
      const result = validateMemoryFile("event", parsed);
      if (result.ok) events.push(result.value);
      else issues.push({ line: index + 1, message: result.issues.map((i) => `${i.path} ${i.message}`).join("; ") });
    });
    return { events, issues };
  }

  /**
   * Writes a file inside .agents/ (for example design-notes/T-1.json) via a temporary file and
   * rename. `name` must be a relative path that stays inside .agents/.
   */
  async writeFile(name: string, content: string): Promise<void> {
    const target = this.insidePath(name);
    const folder = parentDir(target);
    if (folder) await this.fs.mkdir(folder);
    const temp = this.path(`.write.${newId("tmp")}`);
    await this.fs.writeText(temp, content);
    await this.fs.rename(temp, target);
  }

  /** Reads a file inside .agents/, or null if it does not exist. */
  readFile(name: string): Promise<string | null> {
    return this.fs.readText(this.insidePath(name));
  }

  private insidePath(name: string): string {
    if (!isMemoryRelativePath(name)) {
      throw new Error(`"${name}" must be a relative path inside .agents (no "..", no absolute paths, forward slashes)`);
    }
    return this.path(name);
  }

  /** The current state: the stored snapshot, or a rebuild if it is missing or invalid. */
  async readState(): Promise<State> {
    return (await this.readStoredState()) ?? (await this.rebuildState());
  }

  /** Recomputes the state from the event log (does not write it). */
  async rebuildState(): Promise<State> {
    return rebuild(this.project.flow, (await this.readEvents()).events);
  }

  private async readStoredState(): Promise<State | null> {
    const text = await this.fs.readText(this.path("state.json"));
    if (text === null) return null;
    try {
      const result = validateMemoryFile("state", JSON.parse(text));
      return result.ok ? result.value : null;
    } catch {
      return null;
    }
  }

  /** Writes to a temporary file, then renames: readers never see a half-written state. */
  private async writeState(state: State): Promise<void> {
    const temp = this.path(`.state.${newId("tmp")}.json`);
    await this.fs.writeText(temp, JSON.stringify(state, null, 2) + "\n");
    await this.fs.rename(temp, this.path("state.json"));
  }

  private async withLock<T>(work: () => Promise<T>): Promise<T> {
    const lockPath = this.path(".lock");
    const owner = newId("lock");
    const deadline = Date.now() + this.options.lockTimeoutMs;
    for (;;) {
      if (await this.fs.createExclusive(lockPath, JSON.stringify({ owner, since: Date.now() }))) break;
      await this.clearStaleLock(lockPath);
      if (Date.now() >= deadline) {
        throw new LockTimeout(
          `could not get the memory lock within ${this.options.lockTimeoutMs} ms; another tool is writing to ${this.dir}`,
        );
      }
      await sleep(5 + Math.random() * 20);
    }
    try {
      return await work();
    } finally {
      // Only remove the lock if it is still ours.
      const current = await this.fs.readText(lockPath);
      if (current !== null && current.includes(owner)) await this.fs.remove(lockPath);
    }
  }

  private async clearStaleLock(lockPath: string): Promise<void> {
    const content = await this.fs.readText(lockPath);
    if (content === null) return;
    let since = 0;
    try {
      since = Number(JSON.parse(content).since) || 0;
    } catch {
      // An unreadable lock is treated as stale.
    }
    if (Date.now() - since > this.options.staleLockMs) {
      // Re-read just before removing so a lock that was replaced meanwhile is kept.
      if ((await this.fs.readText(lockPath)) === content) await this.fs.remove(lockPath);
    }
  }
}

function withDefaults(options: StoreOptions): Required<StoreOptions> {
  return { lockTimeoutMs: options.lockTimeoutMs ?? 10_000, staleLockMs: options.staleLockMs ?? 30_000 };
}

export { initialState };
