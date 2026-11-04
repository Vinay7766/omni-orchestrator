# Incident response

What to do when something goes wrong with OmniOrchestrator's security. Short on purpose: follow it
in order. Written with the blue-team pass of 2026-11-04 (`blue-team-2026-11-04.md`).

The project is maintained by one person (the owner). "You" below is whoever finds the problem:
the owner, or a user of the app.

## 1. What counts as an incident

- **A decision you did not make.** A phase shows as approved, skipped, sent back or withdrawn and
  you did not do it, or the project page shows the red **"history was changed outside
  OmniOrchestrator"** box.
- **The signing key warning.** The app says the list of keys trusted to sign your decisions was
  changed by another program, or that decisions cannot be signed on this computer.
- **A leaked key.** An API key appears in a project's `.agents/` folder, in a commit, in
  `ui-state.json`, in a log, or anywhere outside the system credential store.
- **Writes into the wrong project.** A decision, lesson or problem appears in a project no tool
  was working on.
- **A malicious skill, dependency or release.** A bundled skill, an npm package or crate, a GitHub
  Action, or an installer that is not what it should be.
- **Data sent somewhere it should not go.** A request to a host other than the AI provider you
  configured.

If you are not sure, treat it as an incident. Stopping for an hour costs little.

## 2. The first hour

**Keep the evidence first, before you change anything.**

1. Close the AI tools working on the project (stop their sessions), so nothing else writes.
2. Copy the project's whole `.agents/` folder somewhere outside the project, with today's date in
   the folder name. The event log (`events.jsonl`) is the record of what happened; never edit the
   original.
3. Copy the app's data folder too: `%APPDATA%\AgentOrchestrator` on Windows,
   `~/.config/AgentOrchestrator` on macOS and Linux (it holds `trust.json`, `projects.json`,
   `ui-state.json` and the installed MCP server). Do not copy the system credential store.

**Then stop the damage**, depending on what happened:

| What happened | Do this |
|---|---|
| A decision you did not make, or the red history box | Do not continue the phase. On the project page, read which lines are named. A decision that is not signed by the app does not count and is not shown as done; still, find out which program wrote it (step 3). If an approval of yours was withdrawn or removed, approve again in the app after checking the work. |
| The trusted keys were changed | The app has already put its own key back. Find the program that changed `trust.json` (it can run as you, so treat it as malware on this computer). Until it is removed, do not trust approvals made in other tools. |
| Decisions cannot be signed | Approvals are refused until the system credential store works (on Linux: a Secret Service such as GNOME Keyring must be running and unlocked). Nothing is lost; decide once it works. |
| A leaked API key | Revoke the key at the provider's site now and create a new one; enter the new key in the app's settings. Then remove the old key from wherever it leaked (a commit needs its history rewritten, and a pushed key must be treated as public even after removal). |
| Writes into the wrong project | Check the project's `.agents-link` file and the tool's MCP settings (`--project`). The MCP server only opens the project it was started for and projects in your Projects list; a link that points elsewhere is refused. Remove the link or the project from the list if it should not be there. |
| A malicious skill | Turn the skill off in the Skills area; delete it from `.agents/skills` in each project. Tell the owner (section 3). |
| A malicious dependency, action or installer | Owner: stop releases, revert to the last known good lockfile or commit, pin the action to a commit you checked (RT-16), and publish a notice. |
| Data sent to an unexpected host | Disconnect the computer from the network if it continues, and keep the network log. |

**Find the cause.** The project page names the line numbers. In the copied `events.jsonl`, each
line shows the `actor` that wrote it and the time. A line without a valid `prev` was not written
by OmniOrchestrator's own code. Check which tools were running at that time.

## 3. Telling people

- **The owner** (for any incident in the app itself, not only in your project): open an issue in
  the repository marked as a security problem, without secrets in it, or contact the owner
  directly. Include the copied event lines (remove any keys first).
- **The AI provider** whose key leaked: revoking the key is the main step; some providers also
  ask to be told.
- **Anyone whose data is involved:** if project text that belongs to someone else (a client, an
  employer) was exposed, they must be told. The law where you and they live may set a deadline
  (in the EU, personal data breaches are reported within 72 hours under the GDPR); check before
  you decide not to tell.
- **Users of the app** (owner): if a release or bundled content was affected, say so in the
  release notes and the README, with what users should do.

## 4. Afterwards

1. Write a short, blameless postmortem: what happened, how it was found, what stopped it, what
   was missing. Blame the gap, not the person.
2. Add a red-team test that reproduces the cause and fails, then fix it (`skills/blue-team`).
3. Update `docs/threat-model.md`: a new row if it was a new kind of attack, or the row's status.
4. If a control did not fire (no warning appeared), add the signal that would have shown it.

## Signals the app gives today

| Signal | Where | Meaning |
|---|---|---|
| Red box "history was changed outside OmniOrchestrator" | Project page | A broken chain (an earlier line edited, removed or inserted), a copied event, or a decision not signed by the app or with a wrong signature. What does not count is not shown as done. |
| Grey note "earlier decisions are not signed" | Project page | Decisions from before signing existed (2026-11-04). Expected for older projects; they still count. |
| Red box about the signing key | Top of the app | `trust.json` was changed by another program and put back, or decisions cannot be signed on this computer. |
| "Updates were not applied", recorded under Problems | Project page | A line in `task-updates.jsonl` was refused (for example it tried to approve a phase). |
| A refusal naming "not a project this server may use" | The AI tool's MCP result | An agent tried to open another project. |

## Known limits

These are not detected today (see the blue-team report):

- Removing the **last** lines of the event log (for example a withdrawal you made) leaves no
  broken chain behind it. Check the phase history if a decision you made is missing.
- A program that rewrites the **whole** log and removes every signature and chain link makes the
  project look like one from before signing; its decisions then show only as the grey "not
  signed" note.
- The VS Code extension's status bar shows live events before they are checked; the gate itself
  does not count an unsigned decision.
