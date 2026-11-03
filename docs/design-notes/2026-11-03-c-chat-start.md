## C + G: a conversation before the phases, and help for people new to the tools (2026-11-03)

Owner decisions 2026-11-03 (tester feedback 2 and the non-technical tester):
- The start is a conversation, like a chat assistant: the person describes the idea, the AI
  restates it and asks questions, the person answers, until the person is satisfied (or the AI
  says it has understood). Then "Start the phases": idea review, research, PRD, architecture and
  tasks run one by one, and each phase still waits for the person's approval (GATE-2; no bulk
  approval).
- A phase document's open questions are answered the same way: a conversation on the document,
  then "Generate final document" revises it with that conversation, then the person approves.
- Nobody is asked "are you technical?". The app checks the computer; if the tools needed are
  missing it says so and offers guided help (install, set up, how to use them).

Problem: the idea form took one block of text and the planning phases had no way to answer the
AI's questions, so documents kept open questions and the AI never checked its understanding with
the person before planning (UND-1). Non-technical testers did not know they lacked tools.

Constraints: the person's own model through `byok_complete` (one prompt per call; no streaming);
everything saved goes through redaction (MEM-6) and into `docs/planning/` (the only folder the
web view may write documents to); the model's text is shown as plain text, never HTML; phases,
gates and memory rules are unchanged (core's PhaseEngine).

Approaches considered:
- A: the conversation is a list of messages kept by the app; each turn sends the transcript with
  fixed instructions (and the understand-intent skill when present) as one prompt. The transcript
  is saved with the project (`docs/planning/idea.md` for the start; `<phase>-discussion.md` for a
  phase), so idea review and later revisions use it. "Generate final document" sends the
  discussion as the change notes through the existing request-changes path, which now revises by
  itself. Small, reuses every rule already tested.
- B: a new memory event type per chat message. Gives an exact record in events.jsonl, but grows
  the log fast, changes the schema and every reader, for no gate rule that needs it.

Chosen: A. The AI marks that it has understood with a final line `READY: <one-line summary>`; the
app shows "Start the phases" as the next step then, but the person can start whenever they like.

System check (G): at the start screen the app runs the setup checks it already has (Git) and tool
discovery. With no AI coding tool or no Git found, it shows: "I checked your computer and did not
find the tools you need ... Do you want help installing and setting them up, and learning how to
use them?" Yes opens the setup guide and switches the project to simple mode; No hides it.

Switch if: providers' streaming is added to byok_complete (then stream replies); conversations
need to be part of the audited record (then approach B for the final summary only).

Edge cases tested: the first message alone (no AI yet) can start the phases; a model failure is
shown with its real message and the person's text is kept; READY with and without a summary;
secrets in the conversation are redacted in the saved transcript; a phase discussion turns into
change notes; nothing missing (no prompt); missing Git or no AI tool (prompt shown).

Generalisation check: no tool, provider or model is named; tests use made-up ones.

Assumptions to confirm: none.
