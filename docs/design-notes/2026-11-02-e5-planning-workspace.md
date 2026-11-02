## E5: planning workspace, from idea to approved task list in the app (2026-11-02)

**Status:** spec approved by the owner 2026-11-02 (decisions at the end). No code yet; slice 1 next.
**Traces to:** PLAN-1, PLAN-2, PLAN-5 (PRD 4.12); GATE-1..4, MEM-3, UND-1, STK-1..3; ARCHITECTURE 8.1, 8.2.
**Skills:** `spec-driven-development`, `frontend-ui-engineering`, `incremental-implementation`, `test-driven-development`, then `code-review-and-quality` and `git-workflow-and-versioning` per commit. `solution-design` is not installed on this machine, so this note follows the same design-note format as E3/E4 in its place.

### Objective

A person types an idea in the desktop app, picks a folder, and the app takes the project through idea review, research, PRD and architecture using their own model (BYOK or local). Each phase uses that phase's skills, writes its document into the project, updates memory, and stops at the review question. The person approves or asks for changes in the app. After architecture is approved the app proposes a task list, the person edits and approves it, and the tasks are created. No IDE is opened (that is E6).

Done when: a project goes from idea to approved task list without an IDE, every phase gated by a person, and someone with no key set up is shown free options instead of an error.

### What already exists (reused, not rebuilt)

- `@omni/core` in the frontend over the memfs commands: `MemoryStore.create/open`, `PhaseEngine` (start, submit, approve, request changes), `checkStackAdr`, `resolvePhaseSkills`, `TaskEngine` (create), `continueAfterDecision`.
- Approve / request changes / run / skip UI (`PhaseActions`, `src/lib/decisions.ts`) and the phase history (E3/E4).
- BYOK settings with keys in the OS credential store (G2), provider + model selection, `list_byok_models`.
- `get_skills` returns every skill with its `phases` and full `content`.

### What is missing

1. **A general BYOK call.** Rust only has `execute_strategic_teardown` (fixed teardown prompt, falls back to an offline template). Planning needs "send this prompt, get text back" through the same provider dispatch, and must never fall back to a template (no fake data).
2. **Create a project from an idea** in the app (today only existing projects are found).
3. **The phase runner**: skills + idea + approved earlier documents -> prompt -> document -> submit.
4. **Task list proposal and approval** after architecture.
5. **No-key guidance** (PLAN-5).

### Capability map (build order = slice order, one commit each)

| Slice | Module | Responsibility | Depends on |
|---|---|---|---|
| 1 | `byok-complete` (Rust) | New command `byok_complete({ byok, prompt }) -> { text, provider, model }` (one user prompt: the providers are all called with a single user message today). The provider dispatch in `generate_teardown` is extracted into one `complete()` that both use. No offline fallback: no provider set up is an error the UI turns into PLAN-5 guidance. Keys never logged; only the selected provider is called; request timeout. | G2 |
| 2 | `planning-start` | "Start from an idea" area: idea text, project name, folder (default from `get_default_project_path`). Creates `.agents/` (flow `build`, mode `full`, actor = the person), writes the idea to `docs/idea.md`, starts `idea-review`. Shows the no-key panel when no provider is set up. | 1 (for the key check only) |
| 3 | `phase-runner` | For the current planning phase: resolve its skills from the catalog, build the prompt (phase skills' full text, the idea, documents of approved earlier phases, the person's change notes if any), call `byok_complete`, write `docs/planning/<phase>.md`, then `PhaseEngine.submit` with documents, skills used and the understanding check. Phase then shows in the history with the existing approve / request changes buttons. Request changes -> "Run again" uses the notes. | 2 |
| 4 | `architecture-adr` | Architecture also asks the model for the stack ADR (written to `docs/decisions/ADR-<n>-stack.md`); `checkStackAdr` must pass before submit; if it fails, the issues are shown and nothing is submitted. | 3 |
| 5 | `task-proposal` | After architecture is approved: the AI configured in the app proposes tasks as JSON (title, requirement ids, kind tags); the app validates it and shows the list read-only. **Approve** creates each task through `TaskEngine` (actor: the agent that wrote it) and records a decision "task list approved" by the person; **Request changes** sends the notes back and the AI rewrites the list. Invalid JSON = honest error + retry, never a guessed list. Needs an optional `kinds: string[]` on the `taskCreated` payload (schema + generated types; approved by the owner). | 4 |

### Rules

- **Who acts.** Phase start and submit are recorded as the agent (`{ kind: "agent", tool: "omni-desktop", model }`); approve, request changes and the task-list approval as the person. The app never approves its own submission: running a phase and approving it are separate clicks in separate states, and core already refuses agent approvals.
- **Model output contract.** The prompt asks for the document plus two required sections: `## Understanding check` (what the model understood, for UND-1) and `## Skills applied` (per skill, what it did with it). If either is missing, nothing is submitted; the person sees "the model's answer was incomplete" with Retry. The skill evidence submitted is the model's own section text, never made up by the app.
- **Prompt size.** Earlier documents are included whole up to a limit (start: 60k characters total, oldest trimmed first, with a note in the prompt saying what was trimmed). The person sees a warning when trimming happened.
- **Memory.** Submit/approve go through core, which writes events and refreshes summary/decisions docs (MEM-3), same as the MCP path, so a project planned in the app opens correctly in an IDE (PLAN-4) and vice versa.
- **Errors are real.** Provider errors (bad key, no model chosen, rate limit, timeout, Ollama not running) are shown with the provider's message; nothing is written to memory on failure.
- **No fixed provider list in the guidance.** PLAN-5 panel explains two kinds of free option in plain words: a local model (with the providers the BYOK engine supports today named as examples) and a provider's free tier, each with numbered steps and a button to Settings.

### Tech stack and commands

Tauri v2, React 19, TypeScript, Tailwind v4, Rust; `@omni/core` workspace package. No new dependencies.

```
npm test                         # vitest, app + packages
npm run build                    # type-check + bundle (vitest does not type-check)
.\scripts\cargo-dev.ps1 test     # Rust tests (slice 1); one cargo at a time
npm run ci:check                 # before push (records pass for the pre-push hook)
```

### Project structure

```
src-tauri/src/commands/byok_engine.rs   slice 1: complete() + byok_complete command (+ tests)
src/lib/byok.ts                         slice 1: typed wrapper for byok_complete
src/lib/planning.ts                     slices 2-4: createFromIdea, runPhase, prompt building, output parsing
src/lib/tasks-proposal.ts               slice 5: parse/validate proposed tasks, create them
src/components/planning/                StartFromIdea, NoKeyGuide, PhaseRunner, TaskProposal (+ .test.tsx each)
docs/design-notes/                      this note
```

The old Track A chat (brief -> staging -> launch IDE) in "Start from an idea" is replaced by `StartFromIdea`. Its launch code (`launch_and_build`, `PreLaunchStagingModal`) is kept, unused by this area, for E6 to reuse or remove.

### Code style

Follows the existing `src/lib/decisions.ts`: functions take `invoke`, return `{ ok, ... }` results with the real reason on failure, never throw to the UI.

```ts
export async function runPhase(invoke: Invoke, root: string, phase: string, notes?: string): Promise<RunResult> {
  try {
    const store = await openStore(invoke, root);
    // ...build prompt, call byok_complete, parse, write, submit
  } catch (error) {
    return { ok: false, error: reason(error) };
  }
}
```

Components under ~200 lines, Lucide icons, zinc/indigo dark theme, keyboard reachable, `role="status"`/`role="alert"` for progress and errors.

### Testing strategy

- **Rust (slice 1):** `complete()` against the existing local mock HTTP bases (`with_native_bases`) per provider shape; no provider -> error (not a template); teardown still works through `complete()`.
- **Lib (slices 2-5), vitest with core's in-memory fs:** create from idea writes `.agents/`, `docs/idea.md` and starts idea-review; a project that already exists is refused; prompt contains only the phase's skills and approved earlier documents; missing `## Understanding check` -> nothing submitted; provider error -> nothing written; request-changes notes appear in the rerun prompt; architecture without a valid ADR -> not submitted; invalid task JSON -> error, no tasks created; created tasks are recorded with the person as actor.
- **Components:** no provider -> NoKeyGuide; running shows progress then the phase awaiting review; errors announced; task list shown read-only with its tags, Approve creates the tasks, Request changes reruns with the notes.
- **Mutation check:** break one rule per slice (e.g. skip the understanding-check guard) and confirm a test fails.
- **Not automated:** a real provider call end to end; done once by hand with a local model if one is available, otherwise stated as not done.

### Boundaries

- Always: tests first per slice; `npm test` + `npm run build` before each commit; cargo test after Rust changes; problems found but not fixed go to PROBLEMS.md under E5.
- Ask first: adding a dependency; changing the phase flows or schemas; deleting the old launcher code; spawning agents or running evals.
- Never: an offline/template answer presented as model output; an approval made by the app; keys in logs, events or documents.

### Approaches considered

- A: run phases in the frontend with core, Rust only does the HTTP call (chosen; matches ARCHITECTURE 8.1, phase rules stay in one language).
- B: a Rust phase runner. Duplicates the phase rules in Rust; rejected.
- C: start the local MCP server and drive it from the app. Two processes and a protocol for something core already does in-process; rejected.

### Owner decisions (2026-11-02)

1. **Document location:** `docs/planning/<phase>.md` in the user's project.
2. **Old Track A chat:** replaced in E5; its launch code (`launch_and_build`, `PreLaunchStagingModal`) stays for E6.
3. **Task list:** written only by the AI configured in the app (the BYOK or local model), never made up by the app or typed by the person. The person reviews it: **Approve** creates the tasks; **Request changes** (with notes) makes the AI rewrite the list. The person does not hand-edit the list. Each task is tagged with the kinds of work it involves (for example interface, backend, tests, security, documentation; short free-text tags, no fixed list in code) so later tool assignment can use them.
4. **Sessions:** one slice per fresh session, starting with slice 1.

Where the owner's wider idea lands (not E5): selecting the IDEs/AI tools for the project and handing the build over is E6 (PLAN-3, TOOL-2); splitting tasks across several tools by best fit (strengths, models, rate limits) is team mode (TEAM-2, TEAM-8, TEAM-9), which uses the task tags from slice 5.
