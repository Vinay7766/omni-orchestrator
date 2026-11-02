import type { Event, Project, State } from "../generated/types.js";
import { FLOWS, OPTIONAL_PHASES } from "../generated/contract.js";
import type { MemoryStore } from "./store.js";

/**
 * Human- and AI-readable views of the event log (MEM-2, MEM-3, MEM-7, UND-5). The log stays
 * the source of truth; these files are rebuilt from it and never record events themselves.
 */

const RECENT_DECISIONS = 5;
const RECENT_EVENTS = 10;
const RECENT_COMPLETED = 5;

type Payload = Record<string, unknown>;
const payloadOf = (e: Event) => e.payload as Payload;
const text = (value: unknown) => (typeof value === "string" ? value : "");

/** One table cell: no line breaks, pipes escaped, so agent text cannot break the layout. */
const cell = (value: unknown) => text(value).replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
/** One line of free text. */
const line = (value: unknown) => text(value).replace(/\r?\n/g, " ").trim();
const row = (cells: unknown[]) => `| ${cells.map(cell).join(" | ")} |`;

const ofType = (events: Event[], type: Event["type"]) => events.filter((e) => e.type === type);

function refsText(e: Event): string {
  const files = e.refs?.files ?? [];
  const commits = e.refs?.commits ?? [];
  return [...files, ...commits].join(", ");
}

/** Latest entry per problem title, oldest first. */
function latestProblems(events: Event[]): Event[] {
  const byTitle = new Map<string, Event>();
  for (const e of ofType(events, "problem_recorded")) byTitle.set(text(payloadOf(e).title), e);
  return [...byTitle.values()];
}

function whereWeAre(project: Project, state: State): string {
  const phase = state.currentPhase;
  const status = phase ? state.phases[phase]?.status : undefined;
  // Same rule as the phase engine's nextPhase: approved, or skipped by a person, is done.
  const next = (FLOWS[project.flow] as readonly string[]).find((p) => {
    const s = state.phases[p]?.status;
    return s !== "approved" && s !== "skipped";
  }) ?? null;
  if (phase && status === "in_progress") return `"${phase}" is in progress.`;
  if (phase && status === "awaiting_review") return `"${phase}" is waiting for a person to review it.`;
  if (phase && status === "changes_requested") return `"${phase}" has changes requested; address them and submit it again.`;
  if (next && OPTIONAL_PHASES[next] !== undefined) {
    return `"${next}" needs a decision from a person: "${OPTIONAL_PHASES[next]}" Start it to run it, or skip it.`;
  }
  return next ? `Next: start "${next}".` : "All phases are done.";
}

export function renderSummary(project: Project, state: State, events: Event[]): string {
  const out: string[] = [];
  out.push(`# ${line(project.name)}`, "");
  out.push(`OmniOrchestrator project · ${project.flow} flow · ${project.mode} mode · created ${project.createdAt.slice(0, 10)}`, "");

  out.push("## Where we are", "", whereWeAre(project, state), "");

  out.push("## Phases", "", "| Phase | Status | Decided |", "|---|---|---|");
  for (const phase of FLOWS[project.flow] as readonly string[]) {
    const p = state.phases[phase];
    out.push(row([phase, p?.status ?? "not_started", p?.decidedAt ?? ""]));
  }
  out.push("");

  const open = state.tasks.filter((t) => t.status !== "done");
  const done = state.tasks.length - open.length;
  out.push("## Tasks", "");
  if (state.tasks.length === 0) {
    out.push("No tasks yet.");
  } else {
    if (open.length > 0) {
      out.push("| Task | Title | Status | Design note |", "|---|---|---|---|");
      for (const t of open) out.push(row([t.id, t.title, t.status, t.designNote ?? (t.trivialReason ? `trivial: ${t.trivialReason}` : "")]));
    }
    out.push("", `${done} of ${state.tasks.length} tasks done.`);
  }
  out.push("");

  // HON-4: test results are what the tool reported; the server does not re-run them (v0.1).
  const completed = ofType(events, "task_completed").slice(-RECENT_COMPLETED).reverse();
  out.push("## Recently completed", "");
  out.push(
    ...(completed.length
      ? completed.map((e) => {
          const p = payloadOf(e);
          const tests = (p.tests ?? {}) as Payload;
          const title = state.tasks.find((t) => t.id === p.taskId)?.title;
          return `- ${line(p.taskId)}${title ? ` ${line(title)}` : ""}: ${line(p.summary)}. Tests: \`${line(tests.command)}\` exit ${String(tests.exitCode)}, reported by ${line(e.actor.tool)} (not re-run)`;
        })
      : ["None yet."]),
    "",
  );

  const approved = (FLOWS[project.flow] as readonly string[]).filter((p) => state.phases[p]?.status === "approved");
  const documents = approved.flatMap((phase) => {
    const last = ofType(events, "phase_submitted").filter((e) => payloadOf(e).phase === phase).pop();
    return last ? [`- ${phase}: ${((payloadOf(last).documents as string[]) ?? []).join(", ")}`] : [];
  });
  out.push("## Key documents", "", ...(documents.length ? documents : ["None approved yet."]), "");

  const decisions = ofType(events, "decision_recorded").slice(-RECENT_DECISIONS).reverse();
  out.push("## Recent decisions", "");
  out.push(...(decisions.length ? decisions.map((e) => `- **${line(payloadOf(e).title)}**: ${line(payloadOf(e).decision)} (why: ${line(payloadOf(e).reason)})`) : ["None yet."]));
  out.push("", "Full list: decisions.md", "");

  const openProblems = latestProblems(events).filter((e) => payloadOf(e).status === "open");
  out.push("## Open problems", "");
  out.push(...(openProblems.length ? openProblems.map((e) => `- **${line(payloadOf(e).title)}**: ${line(payloadOf(e).details)}`) : ["None."]), "");

  const lessons = ofType(events, "lesson_recorded").reverse();
  out.push("## Lessons", "");
  out.push(...(lessons.length ? lessons.map((e) => `- ${line(payloadOf(e).lesson)}`) : ["None yet."]), "");

  out.push("## Recent activity", "");
  for (const e of events.slice(-RECENT_EVENTS).reverse()) {
    out.push(`- ${e.time} · ${line(e.actor.tool)} (${e.actor.kind}) · ${e.type}`);
  }
  return out.join("\n") + "\n";
}

export function renderDecisions(events: Event[]): string {
  const out = ["# Decisions", "", "Newest first. Recorded from the project's event log.", ""];
  const decisions = ofType(events, "decision_recorded").reverse();
  if (decisions.length === 0) out.push("None yet.", "");
  for (const e of decisions) {
    const p = payloadOf(e);
    out.push(`## ${line(p.title)}`, "", `- Decision: ${line(p.decision)}`, `- Why: ${line(p.reason)}`);
    const alternatives = (p.alternatives as string[] | undefined) ?? [];
    if (alternatives.length) out.push(`- Alternatives considered: ${alternatives.map(line).join("; ")}`);
    const refs = refsText(e);
    if (refs) out.push(`- Files and commits: ${refs}`);
    out.push(`- Recorded: ${e.time} by ${line(e.actor.tool)}`, "");
  }
  return out.join("\n");
}

export function renderProblems(events: Event[]): string {
  const out = ["# Problems", "", "Latest status of each problem, from the project's event log.", ""];
  const problems = latestProblems(events);
  for (const [status, heading] of [["open", "Open"], ["resolved", "Resolved"], ["wont_fix", "Won't fix"]] as const) {
    const group = problems.filter((e) => payloadOf(e).status === status);
    out.push(`## ${heading}`, "", ...(group.length ? group.map((e) => `- **${line(payloadOf(e).title)}**: ${line(payloadOf(e).details)} (${e.time})`) : ["None."]), "");
  }
  return out.join("\n");
}

export function renderLessons(events: Event[]): string {
  const out = ["# Lessons", "", "Corrections to how the request was understood. Every tool working on this project should apply them.", ""];
  const lessons = ofType(events, "lesson_recorded").reverse();
  if (lessons.length === 0) out.push("None yet.");
  for (const e of lessons) {
    const context = line(payloadOf(e).context);
    out.push(`- ${line(payloadOf(e).lesson)}${context ? ` (${context})` : ""} — ${e.time}`);
  }
  return out.join("\n") + "\n";
}

/** Rewrites summary.md, decisions.md, problems.md and lessons.md from the event log. */
export async function refreshMemoryDocs(store: MemoryStore): Promise<void> {
  const { events } = await store.readEvents();
  const state = await store.readState();
  const project = store.readProject();
  await store.writeFile("summary.md", renderSummary(project, state, events));
  await store.writeFile("decisions.md", renderDecisions(events));
  await store.writeFile("problems.md", renderProblems(events));
  await store.writeFile("lessons.md", renderLessons(events));
}
