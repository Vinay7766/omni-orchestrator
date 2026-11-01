# OmniOrchestrator Architecture

This document explains how OmniOrchestrator is put together, for contributors. It describes the target design; the "Status" column in section 9 says what exists today.

## 1. What the system does

OmniOrchestrator keeps AI-assisted work **disciplined** (phase by phase, user-approved, designed before coded), **continuous** (one project memory shared by every AI tool), and **honest** (sourced claims, checked citations, real test results).

It does this with four parts that share one contract: the project memory format.

```
            ┌──────────────────────────────────────────────────────────┐
            │                  AI tools (the agents)                    │
            │  Antigravity · Claude Code · Cursor · VS Code · Codex ... │
            └───────┬──────────────────────────────┬───────────────────┘
                    │ MCP (stdio)                  │ editor API
          ┌─────────▼─────────┐          ┌─────────▼──────────┐
          │    MCP server     │          │  Editor extension  │
          │ (agents' channel) │          │  (human channel)   │
          └─────────┬─────────┘          └─────────┬──────────┘
                    │        @omni/core library    │
                    └──────────────┬───────────────┘
                                   │ reads / writes
                    ┌──────────────▼───────────────┐
                    │  Project memory  (.agents/)  │  ◄── the contract
                    └──────────────▲───────────────┘
                                   │ reads / writes (same schemas)
                    ┌──────────────┴───────────────┐
                    │   Desktop dashboard (Tauri)  │
                    │ planning · approvals · pitch │
                    └──────────────────────────────┘
```

**Two channels, on purpose:**

- The **agent channel** (MCP server) lets AI tools read context, submit work, and *request* reviews.
- The **human channel** (extension and desktop app) is the only place a phase can be *approved*. An agent can never approve its own work, because approval actions are not exposed over MCP at all.

## 2. Repository layout

```
omni-orchestrator/
├── packages/
│   ├── core/            TypeScript library: memory store, schemas, phase engine,
│   │                    validators, secret redaction, transcript readers
│   ├── mcp-server/      MCP server (stdio) built on @omni/core
│   └── extension/       VS Code / Open VSX extension built on @omni/core
├── schemas/             JSON Schemas for every memory file, plus test fixtures
│                        (the cross-language contract)
├── skills/              Skill catalog: catalog.json + <skill-id>/SKILL.md
├── src/                 Desktop app frontend (React 19 + TypeScript + Tailwind v4)
├── src-tauri/           Desktop app backend (Rust, Tauri v2)
└── .github/workflows/   CI for all packages
```

npm workspaces tie the TypeScript packages together. The desktop app stays at the repository root to avoid a disruptive move.

## 3. Project memory: the contract

Every project has a `.agents/` folder at its root. Everything is plain Markdown or JSON, readable and editable by hand.

```
.agents/
├── project.json          id, name, created, mode ("full" | "simple"), flow ("build" | "pitch")
├── events.jsonl          append-only log of everything that happened (source of truth)
├── state.json            current snapshot derived from events: phase, phase status, tasks
├── summary.md            current project summary, rewritten at every phase/task completion
├── decisions.md          decisions with reasons and links to files/commits
├── problems.md           known problems and their status
├── lessons.md            corrections the user made to the AI's understanding; served to every tool (UND-5)
├── design-notes/         one note per coding task (solution-design skill output)
├── triage/               one record per mid-build change request
├── citations/            citation check reports
├── handoff/latest.md     the most recent handoff package
├── skills.json           phase-to-skill mapping overrides for this project
├── team.json             IDE/model profiles and task assignments (multi-IDE)
├── outcomes.jsonl        which IDE/model completed which task, and how it went
└── .lock                 write lock (transient)
```

### 3.1 Why an event log

`events.jsonl` is append-only; `state.json` and `summary.md` are rebuilt from it. This gives:

- a full, auditable history (who did what, when, in which tool)
- safe concurrent use by several IDEs: appending an event under a short lock is simple, and state can always be rebuilt
- recovery: if `state.json` is corrupted or hand-edited badly, rebuild it from events

Every event has: `id`, `time`, `type`, `actor` (`{ kind: "agent" | "human", tool, model? }`), `payload`, and `refs` (files and commits it concerns).

### 3.2 Write safety

- Writes go to a temporary file, then an atomic rename (NFR-5).
- Appends and snapshot rebuilds hold `.agents/.lock` (with a stale-lock timeout).
- Every write passes **secret redaction** first (MEM-6). Redaction uses pattern rules for common key and token formats plus high-entropy string detection; matches are replaced with `[REDACTED:<rule>]`.
- Every summary or task entry must reference real files or commits (MEM-4). A validator checks paths exist and commits resolve (`git cat-file -e`).

### 3.3 Git and branches

- OmniOrchestrator's own files in `.agents/` are **gitignored by default**: they hold summaries of private conversations. Users can opt in to committing them. Only our files are ignored, because other tools also keep files in `.agents/` (for example `.agents/skills/`).
- With multi-IDE work, each IDE gets its own **git worktree** (separate folder, separate branch). Every worktree contains a small `.agents-link` file pointing to the main project's `.agents/`, so all IDEs share one memory instead of one copy per branch.

### 3.4 Schemas

Each file has a JSON Schema in `/schemas`, with valid and invalid example fixtures. TypeScript validates with the schemas at runtime; Rust uses `serde` types plus a test that checks every fixture. **Changing a memory format means changing the schema first**; CI fails if either language disagrees with the fixtures.

## 4. Phases and gates

### 4.1 Phase flows

| Flow | Phases |
|------|--------|
| **Build** | idea review → research → PRD → architecture & tasks → build → review → handover |
| **Pitch** | idea description → idea review → research → PRD → presentation → outreach |

### 4.2 Phase state machine

```
not_started ──start──► in_progress ──submit──► awaiting_review
                           ▲                        │
                           └──── changes_requested ◄┤ (human)
                                                    │
                                                approved (human) ──► next phase starts
```

- `submit` (agent, via MCP) requires: the phase's documents, a memory update, and a skills-used list (GATE-3, SKL-4). Planning phases also require an **understanding check**: the request restated, each user example mapped to the category it represents (or marked as a confirmed complete list), and assumptions listed. The user confirms it at the gate (UND-1, UND-2).
- `approve` and `request_changes` exist **only** in the extension and desktop app (GATE-2). The approval event records the human actor and time.
- After the build phase starts, new requests go through **triage** (section 4.4) instead of editing the plan directly.

### 4.3 Tasks inside the build phase

```
todo ──design──► designed ──start──► in_progress ──complete──► done
                     (reopen when the approach was wrong: back to todo, a new design note is needed)
```

- `start` is rejected unless the task has a valid design note (DSN-1), or is marked trivial with a reason.
- A design note is validated for all required sections: problem, constraints, approaches, choice and reason, switch condition, edge cases, and a **generalisation check** (does the design hard-code anything the user only gave as an example?) (DSN-3, UND-3).
- `complete` is rejected unless it includes: a summary, files and commits touched, skills used, and **test evidence**: the command run and its actual output tail (HON-4). Claims without evidence are refused.

### 4.4 Change triage

A request raised after the build phase starts creates a triage record. A sub-agent (run by the AI tool, guided by a triage skill served over MCP) classifies it:

- **separate**: independent feature, queued until current work completes
- **affects-current**: changes current tasks, which are updated with links to the request

The user can override the decision in the extension or app. Queued items are offered when the last current task completes (TRI-3).

## 5. MCP server

A stdio MCP server that each AI tool launches from its own MCP config (for example `~/.gemini/antigravity/mcp_config.json` for Antigravity). It finds the project by walking up from the tool's working directory to the nearest `.agents/` or `.agents-link`.

**Tools exposed (agent channel):**

| Tool | Purpose | Requirements |
|------|---------|--------------|
| `get_context` | Summary, current phase, current task, recent decisions, and the phase's skills, in one call | MEM-2, SKL-2 |
| `get_phase_skills` | Full content of the current phase's skills only | SKL-2, SKL-3 |
| `submit_phase` | Hand the phase in for human review (documents, memory update, skills used, and for planning phases an understanding check) | GATE-3, UND-1 |
| `create_tasks` | Create build tasks from the approved architecture | GATE-1 |
| `submit_design_note` | Attach a validated design note to a task | DSN-1..3 |
| `start_task` / `complete_task` | Task transitions with the checks in 4.3 | DSN-1, HON-4, MEM-3 |
| `record_problem` / `record_decision` | Add to problems or decisions with file/commit refs | MEM-2, MEM-4 |
| `raise_change` / `submit_triage` | Create and classify a mid-build change request | TRI-1, TRI-2 |
| `check_citations` | Verify links load and contain the cited text | HON-2 |

There is deliberately **no** `approve_phase` tool.

**Errors** are specific and actionable: "Task T-12 has no design note. Call submit_design_note first."

### 5.1 Tool discovery and support (no fixed tool list)

**Principle:** OmniOrchestrator must work with *every* AI coding tool a user has, including tools released after it was written. No feature may depend on a hard-coded list of tools. Named tools anywhere in this document are examples only.

**How it works, for each project:**

1. **Discover** every AI coding tool on the machine (below).
2. **Show** the user what was found, with each tool's detected capabilities.
3. **The user selects** which tools to use for this project (and, for multi-IDE work, which models each offers). The selection is stored per project in `.agents/team.json`.
4. Integrate each selected tool at the best level it supports (capability levels, below).

**Discovery is by category, not by name:**

| Category | How it is found |
|----------|-----------------|
| VS Code-family editors (any fork) | Scan installed applications for a `resources/app/product.json`; its `nameLong` and `dataFolderName` identify the editor and where its settings and extensions live, whatever the fork is called |
| AI extensions inside those editors | Scan each editor's extensions folder for extensions that declare MCP servers, chat participants or language-model use in their `package.json` |
| Other desktop applications | Installed-apps registry (Windows uninstall keys, Start Menu; `/Applications` on macOS; `.desktop` files on Linux), matched against an updatable signature list *plus* a keyword scan (agent, AI, code, copilot) for unknown apps, which the user confirms |
| Command-line agents | Executables on `PATH`, plus global package managers (npm, pipx, cargo, brew, winget, scoop) |
| Local model runners | Running local endpoints and installed runners (anything serving an OpenAI-compatible API on localhost) |
| MCP configuration files | Any `mcp.json`, `mcp_config.json` or `mcpServers` / `mcp` block in tool config folders under the user's home directory; a tool that has one supports MCP |

Unknown tools are never hidden: they appear as "detected, capabilities unknown", and the user can confirm what they support.

**Capability levels** (each tool gets the highest one it supports):

| Level | What the tool supports | Integration |
|-------|------------------------|-------------|
| 3 | MCP | Full: phase gates, tasks and memory through the MCP server |
| 2 | Reads instruction files from the project (`AGENTS.md` or its own) | Managed-block pointer to `.agents/` plus file-based progress updates via the extension |
| 1 | Chat only (including browser-based tools) | File-based mode: exported handoff package and copy-paste prompts |

**Adapters are optional hints, not the basis.** An adapter is a data file in `packages/core/adapters/` that adds known details for a specific tool (exact MCP config path, transcript reader, how to open its chat). Discovery and the capability levels work without one; an adapter only makes integration smoother. Adapters can be contributed as one JSON file.

Example adapter:

```json
{
  "id": "kiro",
  "name": "Kiro",
  "mcp": { "configPath": "~/.kiro/settings/mcp.json", "format": "mcpServers" },
  "instructionFile": "AGENTS.md",
  "transcriptReader": null,
  "headless": false,
  "openChat": null
}
```

Known details gathered so far, used to seed the first adapters (examples, not a limit):

| Tool | MCP | Instruction file | Source |
|------|-----|------------------|--------|
| Antigravity | `~/.gemini/antigravity/mcp_config.json` | `GEMINI.md` / `AGENTS.md` | [Google](https://developers.google.com/workspace/guides/configure-mcp-servers) |
| Claude Code | project or user MCP config | `CLAUDE.md` | Claude Code docs |
| Cursor | MCP config | `.cursor/rules/`, `AGENTS.md` | Cursor docs |
| VS Code (Copilot) | MCP config | `.github/copilot-instructions.md`, `AGENTS.md` | VS Code docs |
| Kiro | `~/.kiro/settings/mcp.json` | `AGENTS.md`, steering files | [Kiro changelog](https://kiro.dev/changelog/ide/0-5/) |
| Kilo Code | `kilo.jsonc` (`mcp` key), global or project | to be confirmed | [Kilo docs](https://kilo.ai/docs/automate/mcp/using-in-kilo-code) |
| OpenCode | `opencode.json` (`mcp` key) | `AGENTS.md` | [OpenCode docs](https://opencode.ai/docs/mcp-servers) |
| Codex | MCP config | `AGENTS.md` | Codex docs |
| Browser-based tools (for example Genspark) | none found | none | [listing](https://aiidelist.com/ide/genspark) |

Each adapter's details are verified against the tool's current docs when it is implemented; this table is the starting point.

The same principle applies to **models**: the BYOK engine supports native provider APIs *and* any OpenAI-compatible endpoint (local runners, gateways, other providers), and the models a tool offers are read from its config where possible or entered by the user. No model list is hard-coded.

### 5.2 Real-time sync

The desktop app, the extension in every open IDE, and the MCP server all **watch `.agents/events.jsonl`**. When any component appends an event (an approval, a task update, a memory change), the others see the file change within about a second, read the new events, and refresh.

- **No network port and no background server.** Nothing listens on a socket, so there is nothing to secure or keep running.
- The event log is the single source of truth, so components can never disagree for long: on any doubt, they rebuild from events.
- *Alternative considered:* a local WebSocket daemon. Rejected for now: an extra always-running process and an open local port, for little gain over file watching at this scale.

## 6. Editor extension

Published to the **VS Code Marketplace and Open VSX** (Antigravity installs from Open VSX).

| Feature | How |
|---------|-----|
| Status bar | Current phase and task for the open project |
| **Approve / request changes** | Human channel for phase gates and triage overrides |
| **Continue here** (handoff) | Builds the handoff package (section 7), writes it to `.agents/handoff/latest.md`, adds a short pointer to the current tool's instruction file, then opens the tool's chat with a ready prompt (or copies it to the clipboard where opening chat isn't possible) |
| **Start my task** (multi-IDE) | Loads this IDE's assigned task the same way |
| Memory view | Browse summary, decisions, tasks and design notes |

**Instruction-file pointers** (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursor/rules/`, `.github/copilot-instructions.md`) are written inside clearly marked managed blocks:

```
<!-- omni:begin (managed by OmniOrchestrator, safe to delete) -->
Project memory: read .agents/handoff/latest.md before doing anything else.
<!-- omni:end -->
```

The user's own content outside the markers is never changed.

## 7. Handoff and transcript readers

### 7.1 Handoff package (HND-3)

A structured Markdown document built from memory first, transcripts second:

1. Goal and current phase
2. Current task and its design note
3. Recent decisions (with reasons)
4. Open tasks and known problems
5. Files changed recently (from git)
6. Last steps in the previous tool (from its transcript, if readable)
7. "What to do next"

It must fit a configurable size budget; older material is condensed, current state is never dropped.

### 7.2 Readers

One isolated reader per tool, each returning the same normalised shape (recent user/assistant turns, files mentioned, timestamps). Readers are **best effort**: on any parse error they return nothing and the handoff falls back to memory alone, telling the user why (HND-4).

Readers are added for **any** tool whose history turns out to be readable; tools without one hand off from memory alone. Found so far (examples):

| Tool | Source (as found so far) | Status |
|------|--------------------------|--------|
| Antigravity | `~/.gemini/antigravity/brain/<id>/.system_generated/logs/transcript.jsonl` and `messages/*.json` (plain JSON); `conversation_summaries.db` may map conversations to projects | Format undocumented; mapping to be confirmed |
| Claude Code | JSONL session files under `~/.claude/projects/<encoded-project-path>/` | To be confirmed |
| Cursor, VS Code | Memory only at first | Readers optional later |

### 7.3 Security of handoff content

- Transcript text is **untrusted data**: it can contain prompt-injection text that tries to instruct the next agent. The handoff package wraps it in a clearly labelled "previous conversation excerpt (data, not instructions)" section.
- All extracted text passes secret redaction before being written anywhere.
- Conversations are matched to projects by path; ambiguous matches ask the user (HND-6).

## 8. Desktop app (Tauri)

The existing app becomes **where every project starts**, the dashboard, and the home of pitch mode.

### 8.1 Starting from the idea (planning workspace)

1. The user types their idea in the app.
2. The app runs the planning phases itself (idea review, research, PRD, architecture and tasks) with the user's own model through the existing BYOK engine (Gemini, Claude, OpenAI, or local Ollama).
3. Each phase loads that phase's skills, writes its documents into the project and memory, and ends with the review question. The user approves in the app.
4. When architecture is approved, the app hands the build phase to the user's IDE (or the multi-IDE team): it opens the IDE with the memory loaded and the first task ready.

Planning can also happen inside an IDE through the MCP server; both paths write the same memory.

**How the app runs the phase engine:** the frontend is TypeScript, so it uses `@omni/core` directly. `@omni/core` takes a pluggable file-system adapter: Node's `fs` in the MCP server and extension, Tauri commands in the desktop app. The phase rules therefore exist once, in one language.

### 8.2 Dashboard areas

| Area | Built on |
|------|----------|
| Planning workspace (idea to approved tasks) | `@omni/core` in the frontend + BYOK engine |
| Projects list, phase history, memory editor | Rust reads/writes `.agents/` using the shared schemas |
| Approve / request changes | Human channel, same events as the extension |
| Pitch mode | Existing BYOK engine (Gemini, Claude, OpenAI, Ollama) and teardown code |
| Tool discovery and per-project tool selection | Existing tool detector, rewritten for category-based discovery (section 5.1) |
| Open project in an IDE | Existing launcher |
| Tutorials, simple mode, PRD export | New (v0.5) |
| Skill catalog | Existing skill manager, reading `/skills` |

**Removed:** the Research Hub (live skill search across GitHub, Reddit and HN), by product decision.

The Rust side provides file access, process launching, tool detection and BYOK HTTP calls. Phase rules are not duplicated in Rust: the frontend runs them through `@omni/core`.

### 8.3 Multi-IDE team (v0.6)

Each IDE the user has becomes a **separate agent with a role**:

| Role | Does |
|------|------|
| Builder | Implements tasks (design note first, tests first) |
| Reviewer | Reviews each completed task for correctness and quality |
| Security auditor | Audits security-relevant tasks (input handling, auth, secrets, dependencies) |
| Tester | Writes and runs additional tests, including edge cases from design notes |
| Documentation | Keeps README and docs matching what was actually built |

- **The team is whatever the user selected** for this project from the discovered tools (section 5.1), any number, any kind. Command-line agents and local models can be team members too.
- **Assignment** uses each selected tool's capabilities and the models it offers, then learns from recorded outcomes which IDE and model handle which task types well. Every suggestion shows the evidence behind it.
- **Cross-checking:** work is reviewed by a *different* agent than the one that did it, preferably on a different model, so they don't share the same blind spots. A task is not done until its review (and audit, where relevant) is recorded. Same-model reviews are flagged.
- Each agent works in its own git worktree and branch; the reviewer's approval is required before merging into the main branch.
- GUI IDEs start their assigned task with one click (extension); command-line agents (Codex, Claude Code, OpenCode, Kiro CLI) can be started automatically.

## 9. Key decisions

Each decision lists the alternatives considered, in the style of the `solution-design` skill.

### D1. Where shared logic lives

- **A. TypeScript core library with a pluggable file-system adapter**, used by the MCP server, the extension, and the desktop app's TypeScript frontend (file access through Tauri commands). *Chosen.* The extension must be TypeScript anyway, the official MCP SDK is TypeScript, and the desktop frontend is TypeScript, so all phase logic is written once.
- B. Rust core, with the extension calling a bundled Rust binary. Rejected: platform-specific binaries inside the extension, more build complexity.
- C. Duplicate logic in both languages. Rejected: drift.
- *Switch if:* running the core in the desktop frontend proves too slow or awkward; then run `@omni/core` as a Node sidecar process.

### D2. Memory storage format

- **A. Plain files: append-only event log plus derived Markdown/JSON.** *Chosen.* Human-readable and editable (MEM-5), diff-friendly, no database dependency, safe for concurrent appends.
- B. SQLite. Rejected: not hand-editable, harder to inspect and merge.
- C. Plain Markdown only. Rejected: no reliable machine state or history.

### D3. How phase gates are enforced

- **A. MCP server refuses invalid transitions; approval only through human UI.** *Chosen.* Works in every MCP-capable tool, including Antigravity.
- B. Instructions only ("please follow the phases"). Rejected: this is exactly what fails today.
- C. Tool-specific hooks. Kept as an extra layer where available (for example Claude Code hooks), not the base.

### D4. Memory and git

- **A. Gitignored by default; worktrees share it through `.agents-link`.** *Chosen.* Keeps private conversation summaries out of repos, and keeps one memory across branches.
- B. Committed in each branch. Rejected: memory forks per branch and conflicts on merge.

### D5. Handoff source of truth

- **A. Memory first, transcript excerpt second.** *Chosen.* Memory is structured and checked; transcripts are undocumented and can break.
- B. Raw transcript transfer. Rejected: too large, carries old mistakes, fragile.

## 10. Security summary

| Risk | Control |
|------|---------|
| Secrets leaking into memory or handoffs | Redaction on every write; test suite of sample secrets |
| Agent approving its own work | No approval tool over MCP; approvals are human events only |
| Prompt injection through transcripts or skills | Transcript text labelled as data; skills show content, source and license before use |
| Path traversal through memory references | Referenced paths are resolved and must stay inside the project |
| Shell injection when opening IDEs | Processes started with argument lists, never a shell string (existing launcher) |
| API keys | Stored locally only, never logged, sent only to the provider the user configured |

## 11. Testing strategy

| Layer | Tooling | What is tested |
|-------|---------|----------------|
| `@omni/core` | Vitest | Schemas, event log, snapshot rebuild, lock behaviour, gate rules, redaction, validators |
| MCP server | Vitest + MCP client in tests | Every tool: happy path and each rejection |
| Extension | VS Code extension test runner | Commands, managed blocks, handoff file output |
| Desktop app | Vitest + Testing Library; `cargo test` | UI flows; Rust memory read/write against shared fixtures |
| Contract | Shared fixtures in `/schemas` | TypeScript and Rust both accept valid and reject invalid fixtures |

CI runs all of the above on every push.
