## C18: fast reviews, and batch approvals labelled (2026-11-03)

Spec approved by the owner 2026-11-03. Owner decision on GATE-6 (P-C-01): each phase is approved
or sent back on its own, only after it is submitted; bulk approval is not allowed. If the history
ever shows several phases approved together, the dashboard labels each "Approved as a batch" and
lists every phase in that batch (a safeguard: the app offers no way to do it).

Problem: at a gate the person sees only Approve / Request changes (app) or a list of document
names (extension). Reviews must be quick enough that nobody skips them (GATE-6): a short summary
of the submission and what changed since the last gate.

Constraints: built only from project memory (events.jsonl; honest UI, NFR-7); same content in the
app and the extension; the web view cannot run git; submissions carry no written summary; event
logs stay small (hundreds to a few thousand lines), so one pass over the log is fine.

Approaches considered:
- A: a core function builds the review from the log (latest submission of the phase, every event
  since the last gate decision, earlier change requests for the phase) and a plain-text form of it;
  the app renders the structure, the extension shows the text in its approve dialog. One source
  for both channels; O(n) over the log.
- B: require the agent to write a summary in `submit_phase`. It would be the agent's own claim,
  not evidence, and would break existing clients. Could be added later as an extra line.
- C: a real git diff since the last gate. The web view cannot run git and gate events record no
  commit yet.

Chosen: A, because it is the only one that is factual from memory and shared by both channels.

Batch rule: two or more human `phase_approved` events for different phases, each within 60 s of
the one before, form a batch. A real review means the next phase has to be started, worked on and
submitted between two approvals, which takes far longer than a minute; the window is a constant
so it can be changed in one place.

Switch if: gate events start recording a commit (then add a real file diff, approach C), or a
real flow approves two phases within a minute legitimately (then tighten the rule, for example
"no submission of the second phase between the two approvals").

Edge cases tested: first gate of a project (no earlier gate: "since the project started"); a
resubmission after changes were requested (the earlier notes are shown; "since" starts at the
change request); nothing recorded since the last gate (said, not left blank); a phase not under
review (no review); a submission by an agent with a model; files and commits collected once each;
two approvals more than a minute apart (no batch); three approvals within a minute (one batch of
three, each phase lists all three); an agent's approval is never counted (engine refuses them).

Generalisation check: no phase names are hard-coded; tests use made-up phase lists where it
matters, and any event type with refs contributes its files.

Assumptions to confirm: none.
