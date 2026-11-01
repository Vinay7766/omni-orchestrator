/**
 * Real-time sync (C11): follow a project's events.jsonl as any process appends to it.
 *
 * The follower remembers how much of the log it has already processed and checks only the
 * new complete lines (measured: re-checking the whole log costs 81 ms at 20,000 events, and
 * checking is most of that). A half-written last line waits for the next poll. If the file
 * was replaced or shortened, the follower starts over with a full rebuild.
 *
 * Detecting changes is separate (a ChangeTrigger), so each runtime supplies its own: Node
 * uses file watching (node-watch.ts); the desktop app adds its own in E7. No sockets.
 */
import type { Event, State } from "../generated/types.js";
import { validateMemoryFile } from "../validate.js";
import type { MemoryFs } from "./fs.js";
import { applyEvent, initialState } from "./reduce.js";

export interface LineIssue {
  line: number;
  message: string;
}

type Flow = State["flow"];

/** Parses one log line into `events`, or records why it is not a valid event. */
export function parseEventLine(raw: string, lineNumber: number, events: Event[], issues: LineIssue[]): void {
  if (raw.trim() === "") return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    issues.push({ line: lineNumber, message: "not valid JSON" });
    return;
  }
  const result = validateMemoryFile("event", parsed);
  if (result.ok) events.push(result.value);
  else issues.push({ line: lineNumber, message: result.issues.map((i) => `${i.path} ${i.message}`).join("; ") });
}

export interface SyncUpdate {
  /** Valid events not seen before, in log order. */
  events: Event[];
  /** Lines among the new ones that are not valid events (reported once). */
  issues: LineIssue[];
  /** The project state after the new events. */
  state: State;
  /** True on the first poll and whenever the log was replaced: `events` is then the whole log. */
  reset: boolean;
}

export class EventFollower {
  private processed = 0; // characters of complete lines already processed
  private lines = 0; // line count of the processed part
  private firstLine = ""; // with these two, notices a replaced or edited log
  private lastLine = "";
  private state: State;
  private started = false;
  /** Number of lines checked so far (a guard that only new lines are checked). */
  linesChecked = 0;

  constructor(
    private readonly fs: MemoryFs,
    private readonly path: string,
    private readonly flow: Flow,
  ) {
    this.state = initialState(flow);
  }

  /** New events since the last poll, or null if nothing changed. */
  async poll(): Promise<SyncUpdate | null> {
    const text = (await this.fs.readText(this.path)) ?? "";
    const reset = !this.started || !this.stillTheSameLog(text);
    if (reset) {
      this.processed = 0;
      this.lines = 0;
      this.firstLine = "";
      this.lastLine = "";
      this.state = initialState(this.flow);
    }
    const end = text.lastIndexOf("\n") + 1; // only complete lines
    if (!reset && end <= this.processed) return null;

    const fresh = text.slice(this.processed, end);
    const rawLines = fresh === "" ? [] : fresh.slice(0, -1).split("\n");
    const events: Event[] = [];
    const issues: LineIssue[] = [];
    rawLines.forEach((raw, i) => parseEventLine(raw, this.lines + i + 1, events, issues));
    this.linesChecked += rawLines.length;

    if (rawLines.length > 0) {
      if (this.processed === 0) this.firstLine = rawLines[0];
      this.lastLine = rawLines[rawLines.length - 1];
    }
    this.processed = end;
    this.lines += rawLines.length;
    this.state = events.reduce(applyEvent, this.state);
    this.started = true;
    return { events, issues, state: this.state, reset };
  }

  private stillTheSameLog(text: string): boolean {
    if (text.length < this.processed) return false;
    if (this.processed === 0) return true;
    const first = text.indexOf("\n");
    if (text.slice(0, first) !== this.firstLine) return false;
    const lastStart = this.processed - 1 - this.lastLine.length;
    return text.slice(lastStart, this.processed) === this.lastLine + "\n" && (lastStart === 0 || text[lastStart - 1] === "\n");
  }
}

/** Calls `notify` when the log may have changed; returns a function that stops it. */
export type ChangeTrigger = (notify: () => void) => () => void;

export interface WatchOptions {
  /** Waits this long after a change signal so a burst of writes is read once (default 100 ms). */
  debounceMs?: number;
  /** Called when a check fails (for example the disk is unavailable); watching continues. */
  onError?: (error: unknown) => void;
}

export interface EventWatch {
  /** Settles after the first check (the current events) has been delivered. */
  ready: Promise<void>;
  stop(): void;
}

/**
 * Delivers the current events at once, then every change the trigger signals. Bursts are
 * debounced, checks never overlap, and a change that arrives during a check gets one more.
 */
export function watchEvents(
  follower: EventFollower,
  trigger: ChangeTrigger,
  onUpdate: (update: SyncUpdate) => void,
  options: WatchOptions = {},
): EventWatch {
  const debounceMs = options.debounceMs ?? 100;
  let stopped = false;
  let running = false;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const check = async (): Promise<void> => {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        try {
          const update = await follower.poll();
          if (update && !stopped) onUpdate(update);
        } catch (error) {
          if (!stopped) options.onError?.(error);
        }
      } while (again && !stopped);
    } finally {
      running = false;
    }
  };

  // A signal during a running check reaches check() after the debounce, which records it
  // in `again`, so the running check goes round once more.
  const signal = () => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void check();
    }, debounceMs);
  };

  const release = trigger(signal);
  const ready = check();
  return {
    ready,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      release();
    },
  };
}
