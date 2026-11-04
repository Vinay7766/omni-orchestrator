import { MEMORY_DIR } from "../constants.js";
import type { Event, Project, State } from "../generated/types.js";
import { redactJson, redactText } from "../redact.js";
import { validateMemoryFile, type ValidationIssue } from "../validate.js";
import type { MemoryFs } from "./fs.js";
import { applyEvent, initialState, rebuild } from "./reduce.js";
import { parentDir } from "./paths.js";
import { EventFollower, parseEventLine, type LineIssue } from "./sync.js";
import { checkIntegrity, decisionMessage, PERSON_DECISIONS, prevFor, type IntegrityReport, type Signer, type Trust } from "./integrity.js";
import * as generated from "../generated/validators.js";

// The schema's own rule for a relative path that cannot escape its base folder.
const isMemoryRelativePath = generated.commonRelPath as unknown as (value: unknown) => boolean;

export interface StoreOptions {
  /** How long to wait for another writer's lock before giving up (default 10 s). */
  lockTimeoutMs?: number;
  /** A lock older than this is treated as left by a crashed writer (default 30 s). */
  staleLockMs?: number;
  /**
   * Verifies signed person decisions (C17). With it, a decision counts only when its signature
   * verifies (or it predates the chained log). The app, the MCP server and the extension pass one.
   */
  trust?: Trust;
  /** Signs a person's decision after they confirm it (the desktop app, through Rust). */
  signer?: Signer;
}

type Settings = { lockTimeoutMs: number; staleLockMs: number; trust?: Trust; signer?: Signer };

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

export type { LineIssue } from "./sync.js";

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
    private project: Project,
    private readonly options: Settings,
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
    // The actor is redacted too: its tool and model names come from the caller (an MCP client's
    // own name, a model an agent reports) and could carry a key (RT-5, RT-6).
    const { value: clean, findings } = redactJson({ actor: input.actor, payload: input.payload, refs: input.refs });
    const event: Event = {
      formatVersion: 1,
      id: newId("evt"),
      time: new Date().toISOString(),
      type: input.type,
      actor: clean.actor,
      payload: clean.payload,
      ...(clean.refs ? { refs: clean.refs } : {}),
    };
    const valid = validateMemoryFile("event", event);
    if (!valid.ok) return valid;

    // A person's decision is signed after they confirm it (C17). Where decisions are verified but
    // cannot be signed, it is refused rather than written as a decision that would not count.
    if (PERSON_DECISIONS.has(event.type) && event.actor.kind === "human") {
      if (this.options.signer) {
        const signature = await this.options.signer.sign({
          message: decisionMessage(this.project.id, event),
          projectName: this.project.name,
          summary: decisionSummary(event),
        });
        if (!signature) return { ok: false, issues: [issue("The decision was not confirmed, so nothing was recorded.")] };
        event.signature = signature;
      } else if (this.options.trust) {
        return { ok: false, issues: [issue("Decisions on a phase are signed by the OmniOrchestrator app. Make this decision in the app.")] };
      }
    }

    try {
      return await this.withLock(async () => {
        // Rules are checked against the log, never the snapshot (RT-3, T2.5).
        const state = await this.rebuildState();
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
        // Chain the line to the one before it (C17, T2.2).
        event.prev = await prevFor((await this.fs.readText(this.path("events.jsonl"))) ?? "");
        await this.fs.appendText(this.path("events.jsonl"), JSON.stringify(event) + "\n");
        await this.writeState(next);
        return { ok: true as const, event, redactions: findings.length };
      });
    } catch (error) {
      if (error instanceof LockTimeout) return { ok: false, issues: [issue(error.message)] };
      throw error;
    }
  }

  /**
   * Takes a file in .agents/ out of the way and returns its text (null when it does not exist).
   * The file is renamed first, so a tool appending to it at the same moment starts a new file and
   * nothing is lost (task updates from tools without MCP, issue B).
   */
  async takeFile(name: string): Promise<string | null> {
    const from = this.path(name);
    if (!(await this.fs.exists(from))) return null;
    const taken = this.path(`.taken.${newId("tmp")}.${name}`);
    await this.fs.rename(from, taken);
    const text = await this.fs.readText(taken);
    await this.fs.remove(taken);
    return text;
  }

  /** The project's identity and settings (project.json). */
  readProject(): Project {
    return this.project;
  }

  /**
   * A person changes the project's name and/or mode (APP-2). Checked against the project schema;
   * project.json is rewritten atomically inside the lock, then project_updated is recorded. If
   * writing the file fails, nothing is recorded; an agent is refused (also by the event schema).
   */
  async updateProject(actor: Event["actor"], changes: { name?: string; mode?: Project["mode"] }): Promise<AppendResult> {
    if (actor.kind !== "human") return { ok: false, issues: [issue("Only a person can change the project's name or mode.")] };
    const wanted = {
      ...(changes.name !== undefined ? { name: redactText(changes.name).text } : {}),
      ...(changes.mode !== undefined ? { mode: changes.mode } : {}),
    };
    const payload = Object.fromEntries(Object.entries(wanted).filter(([key, value]) => this.project[key as keyof Project] !== value));
    if (Object.keys(payload).length === 0) return { ok: false, issues: [issue("nothing to change: the name and mode are already these values")] };
    const next = { ...this.project, ...payload } as Project;
    const valid = validateMemoryFile("project", next);
    if (!valid.ok) return valid;

    const result = await this.appendEvent({ type: "project_updated", actor, payload }, undefined, () =>
      this.writeFile("project.json", JSON.stringify(next, null, 2) + "\n"),
    );
    if (result.ok) this.project = next;
    return result;
  }

  /** Every valid event in order; broken or invalid lines are reported, not fatal. */
  async readEvents(): Promise<{ events: Event[]; issues: LineIssue[] }> {
    const text = (await this.fs.readText(this.path("events.jsonl"))) ?? "";
    const events: Event[] = [];
    const issues: LineIssue[] = [];
    text.split("\n").forEach((raw, index) => parseEventLine(raw, index + 1, events, issues));
    return { events, issues };
  }

  /** A follower that reads new events as other processes append them (real-time sync, C11). */
  follow(): EventFollower {
    return new EventFollower(this.fs, this.path("events.jsonl"), this.project.flow);
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

  /**
   * The current state, rebuilt from the event log. state.json is a snapshot written for people
   * and other readers; it is never read back, because anything that can write the folder can
   * edit it (RT-3, T2.5): an edited snapshot must not open a gate.
   */
  async readState(): Promise<State> {
    return this.rebuildState();
  }

  /**
   * Recomputes the state from the event log (does not write it). Events the integrity check does
   * not count (unverified decisions, copies) change nothing (C17).
   */
  async rebuildState(): Promise<State> {
    const { events, uncounted } = await this.checkedEvents();
    return rebuild(this.project.flow, uncounted.size === 0 ? events : events.filter((e) => !uncounted.has(e.id)));
  }

  /**
   * True when decisions on a phase are verified here but cannot be signed (C17): the person makes
   * them in the desktop app. Lets a tool say so before asking the person anything.
   */
  get decisionsNeedApp(): boolean {
    return Boolean(this.options.trust && !this.options.signer);
  }

  /** The log's integrity: chain breaks, copies, and unsigned or wrongly signed decisions (C17). */
  async integrity(): Promise<IntegrityReport> {
    const { report } = await this.readChecked();
    return report;
  }

  private async checkedEvents(): Promise<{ events: Event[]; uncounted: Set<string> }> {
    const { events, report } = await this.readChecked();
    return { events, uncounted: report.uncounted };
  }

  private async readChecked(): Promise<{ events: Event[]; report: IntegrityReport }> {
    const text = (await this.fs.readText(this.path("events.jsonl"))) ?? "";
    const lines = text.split("\n");
    const numbered: { event: Event; line: number }[] = [];
    lines.forEach((raw, index) => {
      const one: Event[] = [];
      parseEventLine(raw, index + 1, one, []);
      if (one.length === 1) numbered.push({ event: one[0], line: index + 1 });
    });
    const report = await checkIntegrity(this.project.id, lines, numbered, this.options.trust);
    return { events: numbered.map((n) => n.event), report };
  }

  private async readStoredState(): Promise<State | null> {
    const text = await this.fs.readText(this.path("state.json"));
    if (text === null) return null;
    let state: State;
    try {
      const result = validateMemoryFile("state", JSON.parse(text));
      if (!result.ok) return null;
      state = result.value;
    } catch {
      return null;
    }
    // The event log is the source of truth (owner's v0.1 issue B): a snapshot that does not end
    // at the log's last event is out of date (another tool appended, or a crash came between the
    // append and the snapshot), so it is rebuilt instead of trusted and later overwritten.
    const { events } = await this.readEvents();
    const last = events.length > 0 ? events[events.length - 1].id : null;
    return state.lastEventId === last ? state : null;
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

function withDefaults(options: StoreOptions): Settings {
  return {
    lockTimeoutMs: options.lockTimeoutMs ?? 10_000,
    staleLockMs: options.staleLockMs ?? 30_000,
    ...(options.trust ? { trust: options.trust } : {}),
    ...(options.signer ? { signer: options.signer } : {}),
  };
}

/** What the person is asked to confirm before a decision is signed. */
function decisionSummary(event: Event): string {
  const phase = String((event.payload as { phase?: unknown }).phase ?? "");
  switch (event.type) {
    case "phase_approved":
      return `Approve the phase "${phase}".`;
    case "changes_requested":
      return `Request changes to the phase "${phase}".`;
    case "phase_skipped":
      return `Skip the phase "${phase}".`;
    case "approval_withdrawn":
      return `Withdraw your approval of the phase "${phase}".`;
    default:
      return `Record "${event.type}".`;
  }
}

export { initialState };
