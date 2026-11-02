## C15: security-pass and release phases; a person decides optional phases (2026-11-02)

Problem: the build flow ended review -> handover, with no release step and no place for a pre-deploy security pass; the security pass must run only with the person's consent (SEC-1), and declining must be recorded (GATE-1).
Constraints: phases.json is the single source of truth (TypeScript generated, Rust reads it at build time); only people approve (GATE-2); existing projects must keep loading; every phase needs at least one skill (A4); no hard-coded phase names in rules (UND-3).
Approaches considered:
- A: consent = a person starts the optional phase; declining = a new human-only `phase_skipped` event, status `skipped`
- B: a separate consent event alongside the phase lifecycle (two records of one decision)
- C: ask in the UI only (nothing enforced; fails the acceptance criteria)
Chosen: A. One decision, one event; the engine and the event schema both enforce "only a person".
Switch if: optional phases ever need a decision recorded before their turn (then add a consent event, B).
Shape: phases.json gains `optional: { phaseId: question }`; the generator exports `OPTIONAL_PHASES`; the rules apply to any optional phase. Build flow: ... review, security-pass, release, handover. "Done" for ordering means approved or skipped.
Rules: only a person can start or skip an optional phase (an agent gets the question to ask); skip only an optional phase, only on its turn, only before it starts; a skip records time, actor and an optional reason.
Found while testing: the extension's approve command started the next phase as the person, so approving review would have started the security pass without asking. It now asks the question (Run it / Skip it; closing decides nothing) and has an "OmniOrchestrator: Decide optional phase" command.
Skills mapped: security-pass -> security-and-hardening, security-review, doubt-driven-development (red-team / blue-team skills come in A10); release -> shipping-and-launch, ci-cd-and-automation, observability-and-instrumentation, git-workflow-and-versioning.
Edge cases tested: agent start / agent skip refused with the question; person start; person skip then release starts; skip of a non-optional phase; skip before its turn; skip after it started; existing project without the new phases; summary text; schema fixtures (human skip valid, agent skip invalid, empty reason invalid, skipped state valid); extension run / skip / close / decide later / nothing to decide.
Generalisation check: no phase name in the rules; a made-up optional phase would follow the same rules through phases.json.
Not in C15: the desktop app's controls for this decision (E3), REL-1's release evidence (checklist, rollback plan, deployment result) and the red/blue procedure skills (A10).
