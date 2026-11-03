# F2: manual run with real tools (checklist)

F1 proved the v0.1 flow in CI with stand-ins (scripted model, in-memory MCP, no real editor). This
run checks what only real tools can show. It also closes the hand checks that E5-E11 left open.
Run it on your own machine (Windows first, NFR-3). Write each result in the **Result** column
(pass / fail + what you saw); copy any failure into PROBLEMS.md under F2.

Allow about 2-3 hours. Use two AI tools **from different vendors** (any two; the checklist names
none). At least one must support MCP; ideally the other reaches a different capability level
(instruction files only, or chat only).

## 0. Before you start

| # | Step | Expected | Result |
|---|------|----------|--------|
| 0.1 | In the repo: `git checkout v0.1-pending-fixes`, `npm install`, `npm run build` | Build finishes with no errors | |
| 0.2 | Start the app: `.\run-dev.bat` | The app window opens in under ~2 s after the build (NFR-4); the Projects area is shown | |
| 0.3 | Settings: set your model provider (a key, or a local model) | Settings saved; close and reopen the app; provider, endpoint and model are still there, the key is not shown in any file (NFR-10) | |

## 1. Planning in the app with a real model (P-E5-01)

| # | Step | Expected | Result |
|---|------|----------|--------|
| 1.1 | "Start from an idea": type a small real idea, create the project in a new empty folder | Project appears in Projects; the folder has `.agents/` | |
| 1.2 | Run idea review | A document appears under `docs/planning/`; it has an understanding check and a "Skills applied" section; the phase shows "review needed" | |
| 1.3 | **C18:** look at the phase waiting for review | A "Review summary" box above Approve: who submitted, documents and skills count, "Since the project started: ..." | |
| 1.4 | Request changes with a short note, let it run again | The new review summary shows "You asked for changes before: <your note>" | |
| 1.5 | Approve, then run and approve research, PRD, architecture | Each phase gated; architecture has a stack decision record shown in the history | |
| 1.6 | Approve the task list | Tasks appear; nothing was created that you did not approve | |
| 1.7 | **Batch label:** check every approved phase in the history | No phase says "Approved as a batch" (you approved each one after reviewing it) | |
| 1.8 | Note any model output problems (format, refusal, output too long) | Write them down; a provider error must show the real message, not a made-up one | |

## 2. The running app: layout and accessibility (P-E4-04, P-E8-01)

| # | Step | Expected | Result |
|---|------|----------|--------|
| 2.1 | Resize the window from narrow (~320 px wide) to wide (~1440 px) on the project page | No text cut off; the workflow chart scrolls sideways when all phases do not fit | |
| 2.2 | Use only the keyboard (Tab, Shift+Tab, Enter, Space) through the menu, project page, chart and list view | Every control is reachable; the focus ring is visible; nothing traps focus | |
| 2.3 | Turn on a screen reader (Narrator on Windows: Ctrl+Win+Enter) and read the chart's list view | Each phase, gate and task is read with its status in words | |
| 2.4 | Skills area: turn a skill off and on; edit one and save | Switch and edit stay as saved; no error message (fixed in this branch, P-E4-01/02) | |

## 3. Handoff to real tools at each level (P-E6-01)

| # | Step | Expected | Result |
|---|------|----------|--------|
| 3.1 | Project page after the task list: select your two tools | Each shows its capability level; an unknown one says "detected, capabilities unknown" | |
| 3.2 | "Hand off the build" to the MCP tool (level 3) | Its MCP config gets an `omni-orchestrator` entry; `AGENTS.md` has the managed block; the tool opens | |
| 3.3 | Open `AGENTS.md` and the tool's own instruction file | Both say not to add AI attribution to commits, pull requests or release notes (C19) | |
| 3.4 | Hand off to the second tool at its level (2: instruction files; 1: copy the package) | Level 2: pointer in its instruction file; level 1: the package text is ready to paste | |
| 3.5 | `.gitignore` | Lists only OmniOrchestrator's own `.agents/` files, once; your own lines kept | |

## 4. Tool A works, tool B continues from memory alone (F2 core, MEM-1..3)

| # | Step | Expected | Result |
|---|------|----------|--------|
| 4.1 | In tool A (MCP): ask it to call `get_context` | It states the project's goal, current phase and next task correctly without you explaining | |
| 4.2 | Let tool A design, start and complete the first task through the MCP tools (`submit_design_note`, `start_task`, `complete_task`) | Each step recorded; completion is refused without the test command and its real output | |
| 4.3 | Check `.agents/events.jsonl` | The events name tool A as the actor (`kind: "agent"`); no key or token anywhere in the file (RT-5/RT-6) | |
| 4.4 | Close tool A. Open tool B on the same folder | Tool B states goal, phase and the *next* task (not the one A finished) from memory alone | |
| 4.5 | Let tool B complete the second task | Recorded under tool B's name; the task list in the app shows both done | |
| 4.6 | Look at the commits both tools made | No AI co-author lines, no "generated with" lines, author is you | |

## 5. Live updates between app and extension (P-E7-01)

| # | Step | Expected | Result |
|---|------|----------|--------|
| 5.1 | Start the extension in VS Code: `code --extensionDevelopmentPath="<repo>/packages/extension" "<your project folder>"` | A new VS Code window opens; the status bar shows the phase and task | |
| 5.2 | Have the app's project page open next to it. Get the build phase submitted (tool A: `submit_phase`) | Both the app and the status bar show "review needed" within about 2 s | |
| 5.3 | In VS Code run "OmniOrchestrator: Approve phase" | **C18:** the dialog shows the review summary (submission, skills, what changed since the last gate) and the review question | |
| 5.4 | Approve it there | The app updates within about 2 s, with no reload | |
| 5.5 | Next optional phase (security pass): decide it in the app | VS Code's status bar follows within about 2 s | |

## 6. Session tree and fresh sessions (P-E10-01, P-E11-02)

| # | Step | Expected | Result |
|---|------|----------|--------|
| 6.1 | Phase history in the app | Each phase lists the sessions that worked on it: tool A, tool B, the editor window, with times | |
| 6.2 | After an approval, use "Start <next phase> in a fresh session" on the project page | A command-line tool starts with the prompt, or a GUI tool gets it ready to paste | |
| 6.3 | In that new session | Before anything else it states goal, phase and next step from memory alone | |
| 6.4 | Close a tool with its window's close button | Its session shows an end time (a hard kill leaves it "still open": known, P-E10-04) | |

## 7. Findings

Write anything unexpected here (what you did, what you saw, what you expected), then copy each
into PROBLEMS.md under F2 with a severity. F3 (README) may only claim what this run and F1 proved.

| # | What happened | Severity | Step |
|---|---------------|----------|------|
| | | | |

## Results: owner's run, 2026-11-03

Run by the owner on Windows with two AI tools from different vendors, on `v0.1-pending-fixes`
(before the tester-feedback fixes H3-H7 were added). Reported per area:

| Area | Checks | Result |
|------|--------|--------|
| Planning with a real model | 1.1-1.6, 1.8 | pass |
| Review summary at the gate (C18) | 1.3, 1.4 | pass |
| No "Approved as a batch" label after one-by-one approvals | 1.7 | pass |
| Layout, keyboard, screen reader | 2.1-2.3 | done (Narrator steps given; reported done) |
| Skills switch and edit stay as saved | 2.4 | pass |
| Handoff, AGENTS.md block | 3.1-3.5 | handoff pass; the "no AI attribution" line (3.3) was **not seen**: the project was handed off before the C19 change. To recheck on a fresh handoff |
| Tool A works, tool B continues from memory alone (F2's core) | 4.1-4.5 | **pass** |
| No key in events.jsonl, commits authored by the person | 4.3, 4.6 | pass |
| Live updates between app and extension | 5.1-5.5 | **not run yet** |
| Session tree and fresh sessions | 6.1-6.4 | pass |

Still open for F2 to be complete:
1. Section 5 (live updates between the app and the extension, P-E7-01).
2. Check 3.3 again, on a project handed off with the current code.
3. Added after this run (tester feedback, H3-H7), seen in tests only so far: your own skills reaching
   a real tool, the chat-style start, the document conversation, the computer check, tools and
   models before the task list with "Set up and open all", and the next phase in the editor's chat.
   Check them in the same sitting as item 1.

### Tester feedback from this run (all addressed in v0.1 except H8)

Form text lost on switching areas (fixed, H1); request changes needed a second click (H2); no way
to add skills, and skill edits did not reach the IDE tools (H3); no way to answer a document's
questions, and no conversation before planning (H4); nobody checked whether the person needed help
with the tools (H5); tools and models should come before the task list, with tasks split by fit
and a guide to start (H6); the next phase should open in the editor's chat (H7); pitch mode and the
overall UI/UX need work (H8, deferred by the owner); why files are written into the project (answered;
no change, by the owner's decision).
