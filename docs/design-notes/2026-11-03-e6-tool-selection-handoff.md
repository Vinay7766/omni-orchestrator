## E6: select tools and hand off the build phase (2026-11-03)

**Status:** spec approved by the owner 2026-11-03, with all five proposals in "Open questions" accepted as proposed (P-E5-08 becomes slice 6).
**Traces to:** TOOL-2, PLAN-3 (PRD); TEAM-1 (selection only; assignments are team mode); ARCHITECTURE 3, 3.3, 5.1, 8.1 step 4.
**Skills:** `spec-driven-development` (this note), then per slice `incremental-implementation`, `test-driven-development`, `frontend-ui-engineering`, `security-and-hardening`, and `code-review-and-quality` + `git-workflow-and-versioning` per commit. `solution-design` is not installed on this machine, so this note uses the E3/E4/E5 design-note format in its place.

### Objective

After the architecture phase and the task list are approved, the project page shows every AI tool found on the computer with its capability level and the evidence for it. The person ticks the tools to use for this project. The selection is saved in `.agents/team.json` and can be changed at any time. For each selected tool, one click sets it up at its level and opens it, with project memory loaded and the first task ready:

| Level | Set-up | Opened how |
|---|---|---|
| 3 (MCP) | Our server entry in the tool's MCP config for this project (existing `setup_tool`, with backup), plus everything level 2 does | Started from its own install (discovery), or told how (terminal command / host editor) |
| 2 (instruction files) | Managed block in `AGENTS.md` (what the project is, where memory is, the next task) and the pointer block in the tool's own instruction files when an adapter names them | Same |
| 1 (chat only) | Handoff package written to `.agents/handoff/latest.md` (summary, approved documents list, next task, rules), shown in the app with a Copy button | The person pastes it into the tool |

Done when: selection persists in `team.json`; the project `.gitignore` lists only OmniOrchestrator's own `.agents/` files; each level works with at least one real tool on the owner's machine (checked by hand; a level with no tool installed is reported as not checked); the unused old launcher code is gone or reused (P-E5-10).

### What already exists (reused)

- `discover_tools` (C10/C12): open string ids, category, capability 3 / None, evidence, launch command, executable, host editor.
- `setup_mcp` / `setup_tool` (D5): merges our entry into another tool's config, keeps its keys and order, backup once, refuses unsafe files with a hand-copy snippet.
- `apply_managed_block` (TS and Rust, shared test cases) and `write_pointer`; adapters (C13) with `instructionFiles`.
- `launch_with` in `sync_launcher.rs`: starts only a program discovery found; the web view sends an id, never a path.
- `TaskEngine` state (tasks with `kinds`), `PhaseEngine` (build phase start), memfs commands for `.agents/`.

### What is missing

1. A `team.json` schema and a core reader/writer.
2. The text written into `AGENTS.md` / the handoff package, built once in core so the MCP server and extension can reuse it.
3. A Rust handoff command per tool (replaces `launch_and_build`, which writes the old `AUTONOMOUS_RUNNER.md` / `session-state.json` / fixed rules).
4. The `.gitignore` managed block (`#` comment markers; the HTML markers do not work in `.gitignore`).
5. The team panel in the project page.

### Capability map (build order = slice order, one commit each)

| Slice | Module | Responsibility | Depends on |
|---|---|---|---|
| 1 | `team-schema` | `schemas/team.schema.json` + generated types: `{ formatVersion, members: [{ toolId, name, capability: 1\|2\|3, confirmedByPerson: bool, addedAt }], updatedAt }`. Core `readTeam` / `saveTeam` through the store (atomic write, redaction like every write). Saving records a decision by the person ("team for this project: A, B"). | - |
| 2 | `handoff-text` | Core `buildHandoff(state, summary)` -> `{ agentsBlock, package }`: project name, phase, where memory is, the first open task (lowest id, status open) with its requirement ids and kinds, the rule to use the MCP tools when connected and otherwise to update memory through the files. No tool names in the text. | 1 |
| 3 | `handoff-command` (Rust) | `hand_off_tool({ projectPath, toolId, level, agentsBlock })`: project path must be absolute and hold `.agents/project.json`; tool id must be one discovery finds now; level must not exceed what discovery found unless the member is `confirmedByPerson`. Writes the `AGENTS.md` managed block (size cap), the adapter pointer files, the `.gitignore` block; level 3 also runs `setup_tool` with the project. Starts the tool via `launch_with`. Returns every file touched, backup paths and the honest launch message. | 2 |
| 4 | `team-panel` (UI) | In the project page once the task list is approved: discovered tools grouped by level with evidence; unknown-level tools need the person to pick a level (confirm); Save -> `team.json`; per member "Set up and open", results shown (files, backup, manual MCP snippet when refused, handoff package with Copy for level 1). The first handoff starts the build phase, recorded as the person. | 3 |
| 5 | `old-launcher-removal` | Remove `PreLaunchStagingModal`, `generate_project_brief`, `launch_and_build`, `prepare_project_staging`, `AUTONOMOUS_RUNNER.md` / `session-state.json` / fixed rules, and the start-up `discover_tools` call; tests updated, the launch tests move to `hand_off_tool`. | 4 |

### Rules

- **Who acts.** Selecting tools, confirming a level and handing off are the person's actions. The app never picks tools for them (no default selection).
- **Files of other programs.** Only our entry / our managed block is changed; backups as in D5; a file we cannot edit safely is left alone and the person gets the text to add by hand.
- **Nothing executed except a discovered program.** The program comes from discovery on the Rust side; the web view sends only ids.
- **Honest results.** "Opened" only when the process started; a tool that cannot be started directly gets the exact instruction instead; level 1 never claims the tool received anything.
- **No tool names in code** (C12): levels come from discovery or the person, file names from adapters.

### Tech stack and commands

No new dependencies.

```
npm test                         # vitest, app + packages
npm run build                    # type-check + bundle
.\scripts\cargo-dev.ps1 test     # Rust tests; one cargo at a time
npm run ci:check                 # before push
```

### Project structure

```
schemas/team.schema.json                  slice 1 (+ generated types, Rust model)
packages/core/src/team/                   slices 1-2: team.ts, handoff.ts (+ tests)
src-tauri/src/commands/handoff.rs         slice 3 (moves launch_with + write_pointer out of sync_launcher.rs)
src/lib/team.ts                           slices 3-4: typed wrappers, save/hand-off flow
src/components/team/TeamPanel.tsx         slice 4 (+ test), shown from ProjectDetail
```

### Code style

As `src/lib/decisions.ts`: functions take `invoke`, return `{ ok, ... }` with the real reason, never throw to the UI. Components under ~200 lines, Lucide icons, zinc/indigo dark theme, keyboard reachable, `role="status"` / `role="alert"`.

### Testing strategy

- **Core:** team.json round trip and schema refusal (unknown level, duplicate tool); save records the person's decision; handoff text names the first open task, skips done tasks, says "no open task" honestly, contains no tool name.
- **Rust:** relative path and folder without `.agents/project.json` refused (RT-11 shape); unknown tool id refused; level above the discovered one refused unless confirmed; `AGENTS.md` user text outside the block kept; `.gitignore` block added once, user lines kept, rerun unchanged; level 3 writes the project MCP config with backup; launch only via the discovered command (fake spawner); made-up tools only, no real tool names.
- **Components:** no default selection; unknown tool needs a level before Save; results and errors announced; level 1 shows the package with Copy.
- **Mutation check:** break one rule per slice (e.g. drop the level check) and confirm a test fails.
- **Not automated:** opening real tools; done by hand on the owner's machine per level, reported per level.

### Boundaries

- Always: tests first per slice; `npm test` + `npm run build` before each commit; cargo test after Rust changes; found-but-unfixed problems go to PROBLEMS.md under E6.
- Ask first: schema changes beyond `team.json`; deleting code outside slice 5's list; spawning agents or running evals.
- Never: the app selecting or approving for the person; running a program the web view named; overwriting a user's file outside our managed blocks.

### Approaches considered

- A: handoff text built in core (TS), Rust only writes files and starts programs (chosen; the MCP server and extension can reuse the text).
- B: all in Rust. Duplicates task/state reading in Rust; rejected.
- C: keep `launch_and_build` and extend it. It writes files the memory format no longer uses (`AUTONOMOUS_RUNNER.md`, `session-state.json`); rejected.

### Open questions for the owner

1. **What `.gitignore` lists.** ARCHITECTURE 3.3 says all of OmniOrchestrator's `.agents/` files are ignored by default (they hold summaries of private conversations), with opt-in to commit later. Proposed: list each of our files and folders (`project.json`, `events.jsonl`, `state.json`, `summary.md`, `decisions.md`, `problems.md`, `lessons.md`, `design-notes/`, `triage/`, `citations/`, `handoff/`, `skills.json`, `team.json`, `outcomes.jsonl`, `.lock`), never `.agents/` as a whole. Consequence: a fresh clone has no project memory until the opt-in exists.
2. **Recording a team change.** Proposed: a decision by the person plus `team.json` (no new event type). Alternative: a new `team_changed` event (schema change).
3. **Build phase start.** Proposed: the first handoff starts the build phase, recorded as the person.
4. **Models per tool** (TOOL-2 "which models each offers"). Proposed: left to team mode (v0.6); `team.json` has no models field yet.
5. **P-E5-08** (`create_tasks` over MCP lacks `kinds`). Proposed: add it in this task as a small extra slice, since level-3 tools create tasks through it.

### As built (2026-11-03): changes from the spec

- **Commits:** 59dc17f (team.json), acd1ae4 (handoff text), b95037e (`hand_off_tool`), 0d4aa11 (team panel), 5812889 (old launcher removed), 1b3cc0b (`create_tasks` kinds, slice 6).
- **Task line:** state keeps no requirement ids per task, so the handoff names the task id, title and kinds. The next task is the one in progress, else the first not done.
- **Untrusted text in the handoff:** task titles and the project name are written as one line of at most 200 characters, because other AI tools read the block as instructions.
- **Who checks what:** Rust reads the level from `.agents/team.json` itself; the web view sends only the folder, the tool id and the AGENTS.md text (at most 16 KB, no block markers). A file, or a folder on the way to it, that is a link is refused before anything is written.
- **`.gitignore`:** a `# omni:begin` / `# omni:end` block lists each of OmniOrchestrator's `.agents/` files (and its temporary `.agents/.write.*` files), never the folder; written at every level.
- **Level 3 when MCP cannot be set up** (server not built, unsafe config): the reason is returned with the entry to add by hand; the instruction files and the start still happen.
- **Pointer text** in the tool's own instruction files now says AGENTS.md names the memory and the next task (the old text named `.agents/skills`).
- **RT-11 fixed** by slice 5: the old launcher was the only code that passed a relative path to a program; the red-team test now runs against `hand_off_tool`.
- **Known gaps:** P-E6-01..08 in the private problems register (no real tool opened yet at any level; a per-user MCP entry is shared by all projects; local paths in project MCP configs; and others).
