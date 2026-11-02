# ADR-001: Stack for the OmniOrchestrator desktop app

## Status
Proposed. Written on 2026-11-02 as the dry run of the `stack-selection` skill
(A10). It records, after the fact, the choice the project already made, so
the owner confirms or corrects the constraints below before it becomes
Accepted.

## Date
2026-11-02

## Context and constraints
Taken from the PRD's non-functional requirements and the existing code;
**to be confirmed by the owner** (Step 1 of the skill asks the person
directly; in this dry run they were read from the project's own documents).

Hard filters:
- **Local-first** (NFR-1): all project data on the user's machine; no account,
  no cloud database, no background telemetry.
- **Windows, macOS and Linux** (NFR-3, NFR-9), Windows first; CI runs every
  test suite on all three.
- **API keys only in the operating system's credential store** (NFR-10), never
  in plain files.
- **Starts IDE processes without shell injection** (NFR-2).

Weighted criteria:
- Starts in under 2 seconds (NFR-4) and stays light, since it runs beside IDEs
  and AI tools (high).
- The maintainer's skills: TypeScript and React for the UI, Rust already in
  use for the backend (high).
- One shared TypeScript core used by the app, the MCP server and the VS Code
  extension (medium).
- Small download (medium).

Assumptions (not stated in the PRD): a solo maintainer; no budget for paid
frameworks; the project's licence is Apache-2.0, so dependencies must be
compatible with it.

## Options considered
Facts read from official pages on 2026-11-02.

| Criterion | A: Tauri 2 (Rust + system web view, React UI) | B: Electron (Node.js + bundled Chromium, React UI) | C: Local web app (Node.js server, UI in the user's browser) |
|---|---|---|---|
| Three desktop OSes (hard) | Yes: macOS 10.15+, Windows 7+ (WebView2, preinstalled on Windows 10 1803+), Linux with webkit2gtk-4.1 ([prerequisites](https://v2.tauri.app/start/prerequisites/)) | Yes (Windows, macOS and Linux builds are published; platform minimums not checked in this dry run: **unverified**) | Yes, wherever Node.js and a browser run |
| Keys in the OS credential store (hard) | Yes: the app already uses the `keyring` crate (Windows Credential Manager, macOS Keychain, Linux Secret Service) | Partly: `safeStorage` uses Keychain on macOS and DPAPI on Windows, but on Linux without a secret store "items ... will be unprotected as they are encrypted via hardcoded plaintext password" ([safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)); the app must detect `basic_text` and refuse | No built-in credential-store API was found in Node.js (**unverified**); a third-party native module would be needed (not evaluated) |
| Local-first, no account (hard) | Yes | Yes | Yes, but it opens a local HTTP port that other local programs and web pages can reach, which needs its own protection |
| Starts IDE processes safely (hard) | Yes: Rust `std::process::Command` without a shell (current code) | Yes: Node `child_process` without `shell: true` | Yes, same as B |
| Start-up time and size (high) | Uses the system web view, so nothing extra is bundled; Tauri describes its binaries as "very small" without figures ([size](https://v2.tauri.app/concept/size/)) | Bundles Chromium and Node.js with every app (unverified size figures) | No desktop shell to start; the browser does the work |
| Maintainer's skills (high) | TypeScript/React UI plus Rust backend: both already used here | TypeScript only | TypeScript only |
| Shared TypeScript core (medium) | Core runs in the UI and Node packages; Rust side reads the same JSON schemas | Core runs everywhere directly | Core runs everywhere directly |
| Current version and support | 2.12.3 (Oct 10, 2026) ([releases](https://v2.tauri.app/release/)) | 45.2.1 (Oct 31, 2026); "the latest three stable major versions are supported" ([releases](https://releases.electronjs.org/), [timelines](https://www.electronjs.org/docs/latest/tutorial/electron-timelines)) | Node.js 26 is Active LTS from 2026-10-28, end of life 2029-04-30 ([Node release schedule](https://github.com/nodejs/release#release-schedule)) |

## Decision
**Tauri 2** is the best fit for these constraints. It is not "the best
desktop stack": it is the one that meets every hard filter today without
extra work, uses skills the maintainer already has, and keeps the app light
beside the IDEs it orchestrates.

## Why the others lost
- **B, Electron:** meets the hard filters only if the app adds a check for
  Linux machines without a secret store, and bundles a browser engine with
  every install. It would win on a single-language codebase.
- **C, local web app:** the simplest to build, but it appears to need a native
  module for the credential store (unverified), and a local HTTP server is exposed to other
  programs and web pages on the machine, which adds work and risk to a tool
  whose job involves secrets and launching processes.

## Switch conditions
- If maintaining Rust becomes the bottleneck (for example, contributors only
  know TypeScript), **B** becomes the better fit, provided the Linux
  `basic_text` case is handled.
- If a browser or hosted version becomes a requirement, **C** (or a hosted web
  app) must be reconsidered, together with a different place for secrets.
- If the system web view causes rendering bugs on a supported platform that
  cannot be worked around, **B** removes that variable by bundling Chromium.

## Consequences and risks
- Two languages (TypeScript and Rust) to build, test and review; CI already
  covers both on three operating systems.
- The app depends on each OS's web view: WebView2 on Windows, WebKit on macOS
  and webkit2gtk-4.1 on Linux. Rendering differences are caught by testing
  on all three (NFR-9).
- Keys depend on the OS credential store being available; where it is not,
  the PRD's open decision says keys are not stored and must be re-entered.

## Sources
Read on 2026-11-02:
- https://v2.tauri.app/release/
- https://v2.tauri.app/start/prerequisites/
- https://v2.tauri.app/concept/size/
- https://releases.electronjs.org/
- https://www.electronjs.org/docs/latest/tutorial/electron-timelines
- https://www.electronjs.org/docs/latest/api/safe-storage
- https://github.com/nodejs/release#release-schedule
