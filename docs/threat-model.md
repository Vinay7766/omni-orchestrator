# OmniOrchestrator threat model

Status: first version, 2026-11-02 (PRD SEC-6, task A10), revised the same day
after two fresh-context adversarial reviews (doubt-driven development) found
twelve and then thirteen gaps, each confirmed against the code before it was
folded in. Owner review needed for every
risk marked **proposed accepted risk**: only a person accepts a risk.

This document says what OmniOrchestrator protects, where untrusted data comes
in, what an attacker could do with it, and what stops them. The red-team
procedure (`skills/red-team`) works from this list: every threat here should
have a test that tries it, or a written reason why it cannot be tested.

## What the system is

- **Desktop app** (Tauri 2: Rust backend, React UI in a web view): manages
  projects, phases and approvals, stores BYOK keys, calls AI providers,
  launches IDEs, writes MCP entries into other tools' config files, writes
  skills into projects.
- **MCP server** (`packages/mcp-server`): the interface AI agents use to read
  project memory and submit work.
- **VS Code extension** (`packages/extension`): shows the phase and lets a
  person approve or request changes.
- **Shared core** (`packages/core`): memory store, phase and task engines,
  schemas, secret redaction.
- **Project memory**: files under each project's `.agents/` folder, including
  the event log `events.jsonl`, on the user's machine (local-first, NFR-1).
- Not present any more: the research hub described in older notes
  (`research_engine.rs` no longer exists). If research comes back, its results
  are untrusted input (NFR-2) and get a row under T1.

## Assets

| Asset | Why it matters |
|---|---|
| BYOK API keys | Money and account access at the AI provider |
| Human approvals in the event log | Phase gates are the product's core promise: only a person moves a project forward (GATE-2) |
| Project memory (decisions, problems, lessons, design notes, phase documents) | Later agents trust it as context; corrupting it steers future work |
| Skills written into projects | Agents follow them as instructions |
| The user's machine and files | The app launches processes and reads and writes files |
| Other tools' config files | The app edits MCP config of IDEs and agents |
| The user's project content | Leaves the machine when sent to an AI provider or read by a cloud agent |

## Trust boundaries

1. **Web view to Rust (Tauri IPC).** The React UI calls Rust commands. Code
   running in the web view (through any future injection bug or a compromised
   frontend dependency) can call every command the app exposes, with any
   arguments.
2. **Agent to MCP server.** Any MCP client can call the tools, for any project
   path. Agents can be steered by what they read.
3. **Agent or program to the file system.** AI tools run as the same OS user
   and can write `.agents/`, the settings and custom-skill files directly,
   bypassing the app and the MCP server.
4. **VS Code extensions to our extension's commands.** Any extension or agent
   inside VS Code can invoke registered commands.
5. **App to AI provider.** Keys and prompts leave the machine; responses come
   back as untrusted text.
6. **App to the operating system.** Launching IDEs, reading the Windows
   registry, the OS credential store.
7. **App to other tools' configs and instruction files.** Files the app does
   not own.
8. **Third-party content to agents**: bundled skills, dependency files,
   fetched documentation, transcripts (planned).
9. **Dependencies and build pipeline**: npm and crates.io packages, the Rust
   toolchain, GitHub Actions.

## Status values

- **in place**: a control exists in the code; the red team's test (listed in
  the last column) is what confirms it. Until that test exists and passes,
  treat the row as a claim.
- **partly**: a control exists but has the gaps listed.
- **planned**: no control yet; the task that adds it is named.
- **open**: no control and no task yet.
- **proposed accepted risk**: the author suggests accepting it; the owner
  decides.

## Threats

### T1. Prompt injection from content an agent reads

Sources: web pages, dependency files and READMEs, third-party skills, AI tool
transcripts, provider responses, project memory written by an earlier agent.

| ID | Threat | Current control | Status | Red-team test idea |
|---|---|---|---|---|
| T1.1 | An injected agent approves its own phase through the MCP server | The phase engine refuses approvals from a non-human actor (`packages/core/src/engine/phases.ts`); the MCP server records every call with an agent actor (`packages/mcp-server/src/server.ts`) | in place for the MCP route (the file route is T2.1) | Call `submit_phase` and every approval path through the MCP server; assert no human approval is recorded |
| T1.2 | A malicious or careless bundled skill tells agents to do harm | Vetting: each bundled skill read in full and pattern-scanned, unmodified copy pinned to a commit, source and licence recorded (`skills/THIRD_PARTY_LICENSES.md`); a test checks the embedded text equals the file on disk | partly: vetting is manual; nothing re-scans after an update; one accepted hit exists (`android-cli` pipes Google's official installer from dl.google.com into a shell, noted in its source section as "ask the person before installing") | A test that scans every bundled `SKILL.md` for known-dangerous patterns (piping a download into a shell, disabling TLS checks, "ignore previous instructions") with an explicit allow-list of reviewed exceptions, and fails on new hits |
| T1.3 | A skill changed before it reaches a project: `update_skill_content` and `save_custom_skill` (`skill_manager.rs`) replace a skill; the launch payload from the web view carries full skill text that `sync_launcher.rs` writes straight into `.agents/skills`; and the MCP server reads skills from the on-disk `skills/` folder or `OMNI_SKILLS_DIR` (`packages/mcp-server/src/main.ts`), not the embedded copy | The person edits skills on purpose (a feature); nothing records who changed a skill, warns that a bundled skill was edited, or checks what the MCP server serves | partly | Launch with a payload whose skill text differs from the catalog; point `OMNI_SKILLS_DIR` at a folder with a changed skill; assert both are detected or labelled |
| T1.4 | Persistent injection: an agent writes a decision or lesson containing instructions; later agents read memory and follow it | Memory entries are stored as data with the actor who wrote them; instruction files get only a pointer block (`packages/core/src/adapters/adapters.ts`) | partly: nothing marks agent-written memory as untrusted when the next agent reads it | Record a decision containing an instruction through the MCP server; assert the context served to the next agent marks it as agent-written data |
| T1.5 | An injected agent writes into another project: MCP tools accept any `projectPath` (`packages/mcp-server/src/project.ts`), and a cloned repository's `.agents-link` file redirects memory to another folder (`packages/core/src/memory/discover.ts`; `memfs_read_text` reads it anywhere) | None beyond the user's own file permissions | open | Call `record_decision` with a path to a second project, and open a project whose `.agents-link` points elsewhere; decide with the owner whether tools should be limited to registered projects |
| T1.6 | Provider responses contain instructions or markup | Responses are shown as text; React escapes text by default; no `dangerouslySetInnerHTML` in `src/` or `packages/` | in place for rendering (see T4) | Feed a response with HTML and script tags into the UI; assert it renders as text |
| T1.7 | AI tool transcripts carry injected instructions into handoffs | Not built yet (no transcript or handoff code exists) | open: no task yet; the rule for the feature is to treat transcripts as untrusted data (NFR-2) | Add with the feature |

### T2. Forged or edited human approvals

| ID | Threat | Current control | Status | Red-team test idea |
|---|---|---|---|---|
| T2.1 | An agent or any local program appends a fake human approval to `events.jsonl` | None: the file is plain JSON lines, writable by the same user | **planned: C17** (signed human approvals with a key in the OS credential store, hash-chained events, dashboard flags unsigned approvals) | Append a hand-written human `phase_approved` event; today the app accepts it (a known-failing test that C17 turns green) |
| T2.2 | Earlier history is edited or deleted | None | **planned: C17** (hash chain) | Edit an earlier event; assert the dashboard flags it after C17 |
| T2.3 | An optional phase (security pass) is started or skipped by an agent | Only a person can start or skip an optional phase (C15, `phases.ts`) | in place for the MCP route; file route as T2.1 | Existing tests in `phases.test.ts`; the red team re-runs them |
| T2.4 | Another VS Code extension or agent invokes `omni.approvePhase`, `omni.decidePhase` or `omni.requestChanges` (`packages/extension/src/extension.ts`), all of which record human events | A confirmation dialog the person must answer (`gate.ts`, `ui.confirm`) | partly: the dialog is the only barrier, nothing tests that it cannot be bypassed, and it shows document names the agent supplied, which an injected agent can word to mislead | Invoke each command programmatically; assert nothing is recorded without the dialog's confirmation; submit a phase whose document names imitate a different phase |
| T2.5 | An agent edits the state snapshot instead of the log: phase gates read `.agents/state.json` and rebuild from `events.jsonl` only when the snapshot is missing or invalid (`packages/core/src/memory/store.ts`, `readState`), and the flow (which phases exist, including the security pass) comes from the stored project | None | open: C17 as written (signed, hash-chained events) does not cover the snapshot; C17 should verify the snapshot against the log, or always rebuild | Write a `state.json` that marks a phase approved without any event; assert the gate refuses it |
| T2.6 | Script in the web view forges a human approval: the dashboard records approvals as `{ kind: "human" }` from web view code (`src/lib/decisions.ts`, `DESKTOP_PERSON`) through `memfs_append_text` (`memory_fs.rs`) | Only the controls against script injection (T4.1) | partly: one injection is a forged approval; if C17 signs approvals from the web view, a forgery gets signed too, so C17 should sign in Rust after a confirmation the web view cannot fake | With C17: call the append command directly from the web view context; assert the event is not signed as human |

### T3. Key theft

| ID | Threat | Current control | Status | Red-team test idea |
|---|---|---|---|---|
| T3.1 | Keys read from disk | Keys kept in the OS credential store via the `keyring` crate (`src-tauri/src/storage/secrets.rs`); keys found in an older plain-text `settings.json` are moved to the store, or, with no store available, returned to the UI once and removed from the file (`storage/store.rs`) | partly: older copies or backups of `settings.json` may still hold keys | Save a key, then search the app's data folders and `.agents/` for it; start with a legacy `settings.json` and check the key is gone from the file afterwards |
| T3.2 | Keys exfiltrated through the web view: `get_byok_config` returns plain-text keys to the UI (`storage_cmd.rs`), and `list_byok_models` and `execute_strategic_teardown` accept a full config, endpoint included, from the UI (`byok_engine.rs`), so script in the web view can read every key and send it out, either by making Rust call any https host or directly with an image request, which the CSP allows (`img-src https:`) | CSP `script-src 'self'`; no `dangerouslySetInnerHTML`; so script injection is currently unlikely | partly: one injection or compromised frontend dependency exposes every key | Call `execute_strategic_teardown` with a saved provider and a different https endpoint; the safe outcome is that Rust uses only the saved endpoint and never returns keys to the UI |
| T3.3 | Keys written into memory or logs | `packages/core/src/redact.ts` removes known credential shapes from event payloads and refs (`store.ts`) and task notes (`tasks.ts`); best effort by design | partly: the agent-supplied `actor.tool` and `actor.model` are stored unredacted (`packages/mcp-server/src/server.ts`); phase documents and other files agents write are not redacted; neither are files written directly (boundary 3); no handoff code exists yet | Write a memory entry, an actor model name and a phase document containing each supported key format; assert the first two are redacted and record what happens to the document |
| T3.4 | A key sent in clear text | A key may use plain http only to this machine; URLs with embedded credentials are refused (`byok_engine.rs`, `endpoint_base`) | in place | Unit tests for `endpoint_base`: remote http, IPv6 loopback, `localhost.evil.com`, credentials in the URL |
| T3.5 | A key sent to a host the person did not choose | Through the saved settings, keys go only to the configured endpoint; through the IPC path, see T3.2 | partly (T3.2); **proposed accepted risk**: a person who configures a malicious endpoint gives it their key | See T3.2 |
| T3.6 | Another program running as the same user reads the credential store | OS-level behaviour | **proposed accepted risk**: same-user malware is outside what an app can defend against | n/a |

### T4. Unsafe rendering in the dashboard

| ID | Threat | Current control | Status | Red-team test idea |
|---|---|---|---|---|
| T4.1 | Script injection through project names, memory entries, skill text or provider output | React escapes text; no `dangerouslySetInnerHTML`; Tauri CSP `script-src 'self'` (`src-tauri/tauri.conf.json`) | in place | Render each untrusted field with `<script>` and `<img onerror>` payloads; assert nothing executes and the text appears literally |
| T4.2 | `javascript:` or other unsafe URLs in links built from user-editable data: `href={skill.attribution.sourceUrl}` (`SkillCard.tsx`, `SkillDetailModal.tsx`) | Relies on React's handling of `javascript:` URLs (**unverified**) and on the CSP | partly | Save a skill whose source URL is `javascript:alert(1)`; assert clicking it runs nothing; prefer allowing only `https:` links |
| T4.3 | Data sent out through images: the CSP allows `img-src 'self' data: https:`, so any injected script can leak data with `new Image().src = "https://…"`, and an `<img>` built from untrusted data would act as a tracking beacon | None beyond preventing script injection (T4.1) | partly | Check whether the UI needs any external image; if not, restrict `img-src` to `'self' data:` and test that an external image is blocked |
| T4.4 | Inline style injection | CSP allows `style-src 'unsafe-inline'` | **proposed accepted risk** (needed by the UI framework; style alone cannot run script) | n/a |
| T4.5 | The web view opens arbitrary URLs or files | Capabilities are `core:default` and `opener:default` only (`src-tauri/capabilities/default.json`); the opener plugin is registered (`lib.rs`) | partly: `opener:default` allows opening any https URL in the browser, so injected script can send data out in a URL; which UI values reach the opener is not traced | List every call that opens a URL or path; assert none passes untrusted input unchecked; consider a narrower opener scope |

### T5. Supply chain

| ID | Threat | Current control | Status | Red-team test idea |
|---|---|---|---|---|
| T5.1 | A compromised or typosquatted npm package | `package-lock.json` committed; CI installs with `npm ci` | partly: dependencies use `^` ranges (`package.json`), so a local `npm install` can move versions; no `npm audit` gate, no signature check | `npm audit` and `npm audit signatures` in the security pass; a check that the lockfile is unchanged after install |
| T5.2 | A Rust crate changes underneath a build | `Cargo.lock` committed | partly: CI runs `cargo check` and `cargo test` without `--locked` (`ci.yml`) | A CI step with `--locked` that fails when the lockfile would change |
| T5.3 | A bundled skill changes upstream | Skills are copied at a pinned commit, never fetched at run time | in place for upstream changes (local edits are T1.3) | The embedded-content test already fails on any change to a bundled file |
| T5.4 | GitHub Actions change underneath a run, or a poisoned cache reaches a release | None: every action, first- and third-party, is referenced by a movable tag or branch (`actions/checkout@v4`, `dtolnay/rust-toolchain@stable`, `swatinem/rust-cache@v2`, `tauri-apps/tauri-action@v0`); the release job has `contents: write` with `GITHUB_TOKEN` and restores a shared Rust cache (`release.yml`); `ci.yml` has no `permissions:` block, so it runs with the repository's default token permissions | open | A check that fails on any `uses:` line without a 40-character commit hash; no cache in the release job; explicit read-only `permissions:` in `ci.yml` |
| T5.6 | Release installers are not code-signed: the release workflow has no signing secrets or signing step (`release.yml`), so users cannot tell a genuine installer from a modified one | None | open: the `desktop-release` skill describes the fix (signing, notarization, signed updates); it needs a task and the owner's signing identity | Download a release artifact and check its signature; today none |
| T5.5 | The Rust toolchain changes: protection in T6.1 depends on Rust 1.77.2 or later | CI installs `stable` with no pinned version and no `rust-toolchain` file | partly | Pin a minimum toolchain and test it in CI |

### T6. Launching processes, files and other tools' configs

| ID | Threat | Current control | Status | Red-team test idea |
|---|---|---|---|---|
| T6.1 | Command injection when launching an IDE: on Windows the editor launcher is `bin\<name>.cmd` (`tool_discovery.rs`) and PATH launchers may be `.cmd`, `.bat` or `.ps1`; `Command::new` runs `.cmd` and `.bat` files through cmd.exe | No shell is requested (`sync_launcher.rs`); Rust's standard library escapes batch-file arguments since 1.77.2 (the "BatBadBut" fix); the toolchain is not pinned (T5.5) | partly | On Windows, launch a `.cmd` launcher with a project path containing `&`, `"`, `%` and `^`; assert no second process starts |
| T6.2 | Argument injection: a relative "path" such as `--some-flag` reaching the editor as an option (found in the old `sync_launcher.rs`, removed in E6) | `hand_off_tool` (`handoff.rs`), the only code that starts a tool, refuses any project path that is not absolute and has no `.agents/project.json` | in place (RT-11 test) | Launch with the path `--version` or another editor flag; the safe outcome is a refusal or the path made absolute first |
| T6.3 | File-system probing and writes outside projects: `memfs_exists` answers for any absolute path; memory writes are allowed into any folder named `.agents` anywhere on disk (`memory_fs.rs`); `hand_off_tool` writes `AGENTS.md`, `.gitignore` and adapter instruction files in any absolute folder holding `.agents/project.json` and a `team.json` listing the tool (same trust level as the memfs commands; the old launcher commands that wrote to any absolute path were removed in E6) | Writes limited to folders named `.agents` in `memory_fs.rs` only | partly | Through IPC, check an arbitrary path's existence, write into an unregistered `.agents` folder, and stage a project whose `.agents` is a link to another folder; decide with the owner whether to limit all three to registered projects and refuse links |
| T6.4 | Corrupting another tool's MCP config | Only our own entry is added or updated; JSON-with-comments and non-JSON files are left unchanged with a message (`mcp_setup.rs`) | partly: symlinked configs are followed on purpose and a `.omni-backup` is written beside the real target, so a repository that ships a symlinked project-level config makes the app rewrite a file outside the project | Existing `mcp_setup` tests; add a project whose config is a link to a file outside it |
| T6.5 | Overwriting the user's text in instruction files | Only the managed block is changed (`adapters.ts`, `handoff.rs`); `hand_off_tool` refuses a target file, or a folder on the way to it, that is a link (E6) | in place for instruction files and .gitignore; the level-3 project MCP config still follows links (T6.4) | Existing tests; add one with a forged end marker and one with a linked instruction file |

### T7. Project data leaving the machine

| ID | Threat | Current control | Status | Red-team test idea |
|---|---|---|---|---|
| T7.1 | Project text (ideas, plans, code context) is sent to an AI provider by the app (teardowns, planning) or read by a cloud AI agent through the MCP server | Sending happens only to the provider the person configured and only when they run the feature; nothing is sent in the background (NFR-1) | **proposed accepted risk**: using a cloud AI provider means sharing the text sent to it; the person chooses the provider (a local model keeps it on the machine) | Run the app with network access logged; assert no request leaves except to the configured provider during a feature the person started |

## Latest red-team results

Dry run on 2026-11-02 (`docs/security/red-team-2026-11-02.md`), 11 abuse
cases from 10 rows, written as tests:

- Controls that held (now tested): T1.1 (no human approval through any MCP
  route, even when the client calls itself `omni-desktop` or sends extra
  fields), T1.6 and T4.1 (payloads render as text, in jsdom), T4.2 for
  `javascript:` links (React strips them), T3.4 (about 30 endpoint forms).
- Open findings, reproduced: T2.1, T2.2 and T2.5 (approvals forged through
  the event log or the state snapshot), T3.3 (keys in the model name and the
  client name are stored unredacted), T4.2 extended (`data:` and `file:`
  links pass into `href`), T6.2 (`--version` reaches the editor as an
  option).
- Noted, not yet tested: an MCP client can name itself `omni-desktop`, so a
  view that shows only the tool name would show an agent's work as the
  app's.

## Decisions needed from the owner (blocking the security pass)

SEC-6 asks that every threat has a mitigation or an accepted risk. Until the
owner decides, these rows meet neither:

- **Open, no control and no task:** T1.5, T1.7, T2.5, T5.4, T5.6, T6.2. For
  each: assign a task, or accept the risk.
- **Proposed accepted risks:** T3.5, T3.6, T4.4, T7.1. For each: accept,
  or ask for a control.
- **Design input for C17:** T2.5 (the state snapshot) and T2.6 (signing
  outside the web view) are not in C17's current description.

## Out of scope

- Attacks by the user against their own machine.
- Malware already running as the user (see T3.6), except where it can turn an
  agent's ordinary file writes into forged approvals (T2.1).
- Other people's systems or live third-party services: the red team never
  targets them (SEC-2).

## Keeping this up to date

Update this file when a feature adds a trust boundary (new network call, new
file format read, new process launched, new IPC command, new place untrusted
text is shown). The security pass (SEC-2) starts from the latest version.
