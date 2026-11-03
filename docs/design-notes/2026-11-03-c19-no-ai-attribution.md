## C19: no AI attribution in people's projects (2026-11-03)

Problem: AI tools working in a project set up by OmniOrchestrator often add AI co-author trailers,
"Generated with" lines or an AI author identity to commits, pull requests and release notes. The
owner wants the work authored by the person (owner request 2026-11-02, task C19).

Constraints: the app writes instructions for AI tools in three places, and each can be the only
one a tool reads:
- the AGENTS.md managed block and the chat-only handoff package (core `buildHandoff`, one shared
  rules list);
- the pointer inside each tool's own instruction files (Rust `handoff.rs`, `POINTER`), read by
  tools that never open AGENTS.md on their own;
- the fresh-session prompt (core `buildFreshSession`, E11), the first thing a new session reads.
No tool, vendor or model may be named (TOOL-0): the rule describes the category of attribution.

Approaches considered:
- A: one rule sentence in core (`NO_AI_ATTRIBUTION_RULE`), used by the handoff rules list and the
  fresh-session prompt; the same sentence in the Rust pointer, with a test on each side. Small,
  covers every place.
- B: only the AGENTS.md block, as the task text names. Tools that read only their own instruction
  file, or a fresh session started from the prompt, would never see it.

Chosen: A, because the intent is "no AI attribution in any commit made in the project" (UND-2:
the named files are examples of where the app instructs tools), and B leaves two entry points
without the rule.

Switch if: the app gains another text it writes for AI tools; it must carry the rule too.

Edge cases tested: AGENTS.md block, chat package and fresh-session prompt contain the rule (core);
a tool's own instruction file written at level 2 contains it (Rust, made-up tool); the rule names
no tool or vendor.

Generalisation check: the rule covers trailers, generated-by lines and author identities as
categories, with no names; the Rust test uses the existing made-up tool `nebula`.

Assumptions to confirm: none (rule text follows the owner's request in TASKS.md C19).
