import React from "react";
import { CheckCircle2, Circle, CircleDashed, Clock, MessageSquareWarning, SkipForward, type LucideIcon } from "lucide-react";
import type { PhaseHistoryEntry } from "@omni/core";
import { statusWords } from "../../lib/phase-status";

type Actor = PhaseHistoryEntry["submissions"][number]["by"];

/** Icon and text colour per status. The status is always written out too (never colour alone). */
const STATUS_STYLE: Record<PhaseHistoryEntry["status"], { icon: LucideIcon; tone: string }> = {
  not_started: { icon: Circle, tone: "text-zinc-500" },
  in_progress: { icon: CircleDashed, tone: "text-sky-300" },
  awaiting_review: { icon: Clock, tone: "text-amber-300" },
  changes_requested: { icon: MessageSquareWarning, tone: "text-amber-300" },
  approved: { icon: CheckCircle2, tone: "text-emerald-400" },
  skipped: { icon: SkipForward, tone: "text-zinc-400" },
};

const when = (iso: string) => new Date(iso).toLocaleString();
const who = (actor: Actor) => (actor.kind === "human" ? `a person (${actor.tool})` : `${actor.tool}${actor.model ? `, ${actor.model}` : ""}`);

function Submissions({ entry }: { entry: PhaseHistoryEntry }) {
  if (entry.submissions.length === 0) return null;
  return (
    <div className="mt-2 space-y-2">
      {entry.submissions.map((s, i) => (
        <div key={s.time + i} className="text-xs text-zinc-400">
          <p>
            {entry.submissions.length > 1 ? `Submission ${i + 1}` : "Submitted"} by {who(s.by)} · {when(s.time)}
          </p>
          {s.documents.length > 0 && (
            <ul className="mt-1 ml-4 list-disc" aria-label="Documents">
              {s.documents.map((d) => (
                <li key={d} className="font-mono text-zinc-300 break-all">
                  {d}
                </li>
              ))}
            </ul>
          )}
          {s.understandingCheck && <p className="mt-1">Understanding check: <span className="font-mono text-zinc-300">{s.understandingCheck}</span></p>}
          {s.skillsUsed.length > 0 && (
            <ul className="mt-1 ml-4 list-disc" aria-label="Skills used">
              {s.skillsUsed.map((k) => (
                <li key={k.skill}>
                  <span className="text-zinc-300">{k.skill}</span>: {k.evidence}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function Decision({ entry }: { entry: PhaseHistoryEntry }) {
  const d = entry.decision;
  if (d) {
    const verb = d.kind === "approved" ? "Approved" : "Skipped";
    return (
      <p className="mt-2 text-xs text-zinc-300">
        {verb} by {d.by.kind === "human" ? `a person (${d.by.tool})` : who(d.by)} · {when(d.time)}
        {d.reason ? <span className="text-zinc-400"> · Reason: {d.reason}</span> : null}
      </p>
    );
  }
  if (entry.optionalQuestion && entry.status === "not_started") {
    return (
      <div className="mt-2 text-xs">
        <p className="text-zinc-200">{entry.optionalQuestion}</p>
        <p className="text-zinc-400">Optional: only you decide whether it runs{entry.isNext ? ". It is waiting for your decision." : "."}</p>
      </div>
    );
  }
  return null;
}

/** Every phase of a project with what it produced and what was decided (GATE-5). Read-only. */
export const PhaseHistory: React.FC<{ entries: PhaseHistoryEntry[] }> = ({ entries }) => (
  <ol aria-label="Phases" className="rounded-xl border border-zinc-800 bg-zinc-900/40">
    {entries.map((entry) => {
      const { icon: Icon, tone } = STATUS_STYLE[entry.status] ?? STATUS_STYLE.not_started;
      return (
        <li key={entry.phase} aria-label={entry.phase} className="px-4 py-3 border-b border-zinc-800 last:border-b-0">
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-sm font-medium text-zinc-100">
              <Icon className={`w-4 h-4 shrink-0 ${tone}`} aria-hidden="true" />
              {entry.phase}
              {entry.isNext && <span className="px-1.5 py-0.5 rounded bg-indigo-600/20 text-indigo-300 text-[10px] font-semibold uppercase tracking-wide">Next</span>}
            </span>
            <span className={`text-xs shrink-0 ${tone}`}>{statusWords(entry.status)}</span>
          </div>
          {entry.started && <p className="mt-1 text-xs text-zinc-500">Started by {who(entry.started.by)} · {when(entry.started.time)}</p>}
          <Submissions entry={entry} />
          {entry.changeRequests.map((c, i) => (
            <p key={c.time + i} className="mt-2 text-xs text-amber-300 break-words">
              Changes requested by {who(c.by)} · {when(c.time)}: {c.notes}
            </p>
          ))}
          <Decision entry={entry} />
        </li>
      );
    })}
  </ol>
);
