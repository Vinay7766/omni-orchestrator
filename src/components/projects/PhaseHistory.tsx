import React from "react";
import { CheckCircle2, Circle, CircleDashed, Clock, MessageSquareWarning, SkipForward, type LucideIcon } from "lucide-react";
import type { GateReview, PhaseHistoryEntry } from "@omni/core";
import { statusWords } from "../../lib/phase-status";
import { PhaseActions, type PhaseDecisions } from "./PhaseActions";

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

export const when = (iso: string) => new Date(iso).toLocaleString();
export const who = (actor: Actor) => (actor.kind === "human" ? `a person (${actor.tool})` : `${actor.tool}${actor.model ? `, ${actor.model}` : ""}`);

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
          {s.stackAdr && <p className="mt-1">Stack decision record: <span className="font-mono text-zinc-300 break-all">{s.stackAdr}</span></p>}
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

/** The tool sessions that worked on this phase (HND-8). A transcript link is shown, never opened. */
function Sessions({ entry }: { entry: PhaseHistoryEntry }) {
  if (!entry.sessions?.length) return null;
  return (
    <ul className="mt-2 space-y-1 text-xs text-zinc-400" aria-label="Sessions">
      {entry.sessions.map((s) => (
        <li key={s.id}>
          Session: {who(s.by)} · {when(s.started)} · {s.ended ? `ended ${when(s.ended)}` : "still open"}
          {s.transcript && (
            <span>
              {" "}
              · Transcript: <span className="font-mono text-zinc-300 break-all">{s.transcript}</span>
            </span>
          )}
        </li>
      ))}
    </ul>
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
        {d.batch ? (
          <span className="block mt-1 text-amber-300">
            Approved as a batch: {d.batch.join(", ")}. These phases were approved within a minute of each other, without time to review each one.
          </span>
        ) : null}
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

/** What the person needs at the gate (C18, GATE-6): the latest hand-in and what changed since the
 * last gate, all from memory. Shown only on the phase waiting for review. */
function ReviewSummary({ review }: { review: GateReview }) {
  const s = review.submission;
  const since = review.since.from ? `Since the last gate (${when(review.since.from)})` : "Since the project started";
  return (
    <section aria-label="Review summary" className="mt-3 rounded-lg border border-amber-900/50 bg-amber-950/10 p-3 text-xs text-zinc-300 space-y-1.5">
      <p className="font-medium text-amber-200">Review summary</p>
      <p>
        Submitted by {who(s.by)} · {when(s.time)} · {s.documents.length} document{s.documents.length === 1 ? "" : "s"}, {s.skillsUsed.length} skill
        {s.skillsUsed.length === 1 ? "" : "s"} with evidence
      </p>
      {review.earlierChangeRequests.map((c, i) => (
        <p key={c.time + i} className="text-amber-300 break-words">
          You asked for changes before: {c.notes}
        </p>
      ))}
      {review.since.items.length === 0 ? (
        <p>{since}: nothing else was recorded.</p>
      ) : (
        <>
          <p>{since}:</p>
          <ul className="ml-4 list-disc" aria-label="Recorded since the last gate">
            {review.since.items.map((item, i) => (
              <li key={item.time + i} className="break-words">
                {item.text}
              </li>
            ))}
          </ul>
        </>
      )}
      {review.since.files.length > 0 && (
        <p className="break-all">
          Files: <span className="font-mono text-zinc-200">{review.since.files.join(", ")}</span>
        </p>
      )}
      {review.since.commits.length > 0 && (
        <p className="break-all">
          Commits: <span className="font-mono text-zinc-200">{review.since.commits.join(", ")}</span>
        </p>
      )}
    </section>
  );
}

/** Every phase of a project with what it produced and what was decided (GATE-5); with
 * `decisions`, also the person's decisions that apply (E3 slice 3). */
export const PhaseHistory: React.FC<{ entries: PhaseHistoryEntry[]; decisions?: PhaseDecisions; review?: GateReview }> = ({ entries, decisions, review }) => (
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
          <Sessions entry={entry} />
          <Submissions entry={entry} />
          {entry.changeRequests.map((c, i) => (
            <p key={c.time + i} className="mt-2 text-xs text-amber-300 break-words">
              Changes requested by {who(c.by)} · {when(c.time)}: {c.notes}
            </p>
          ))}
          <Decision entry={entry} />
          {review && review.phase === entry.phase && entry.status === "awaiting_review" && <ReviewSummary review={review} />}
          {decisions && <PhaseActions entry={entry} decisions={decisions} />}
        </li>
      );
    })}
  </ol>
);
