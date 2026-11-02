---
name: red-team
description: Use in the security pass, after the person has agreed to run it, to try to break your own project before it ships. Works from the project's threat model, turns each threat into an abuse case and a test that tries it, and reports findings for the blue team. Only ever targets the person's own project, running locally; never other people's systems, live third-party services or real credentials. Use when asked for a red-team pass, a pre-release attack review, abuse-case tests, or "try to break this".
---

# Red Team

The red team's job is to prove the project's security claims wrong, while
breaking nothing real. Every attack becomes a test, so a finding cannot be
argued away and a fix cannot quietly regress. The blue team (`blue-team`
skill) fixes what you find; you do not fix it yourself, because the person
fixing should not also be the person deciding the fix is enough.

## Rules of engagement (read first, every time)

These are not suggestions. If a step would break one, stop and ask.

1. **Consent.** Run only when the person has agreed to the security pass
   (it is optional; they start it). If you are not sure they agreed, ask.
2. **Own project only.** Targets are this project's code, its local build and
   its test environment. Never other people's systems, live third-party
   services, production deployments or anything reached over the internet,
   even if the project talks to them: replace them with local fakes.
3. **No real secrets.** Use fake keys and test accounts. If you find a real
   secret, do not use it: report where it is.
4. **Nothing destructive outside a scratch area.** Write tests and scratch
   files only inside the project (a test folder, a temporary directory). Do
   not delete or rewrite the person's data, memory or history.
5. **Fresh eyes.** Run in a new session or a separate agent that has not
   built the feature, so you do not share the builder's assumptions. If you
   built it, say so in the report.
6. **Do not fix.** Report and hand over.

## Step 1: Start from the threat model

Read the project's threat model (often `docs/threat-model.md`). If there is
none, write one first with the `security-and-hardening` skill (trust
boundaries, assets, STRIDE), and show it to the person: the security pass
should not invent its own scope silently.

List every threat with its stated control and status. Controls marked
"mitigated" are claims to test, not facts.

## Step 2: Look for what the model missed

Before testing the listed threats, spend a short time on the boundaries the
model may have skipped: every place untrusted data enters (network
responses, files from other tools, user input, AI output, content an agent
reads), every place the project runs a process, writes a file it does not
own, or renders text. Add any new threat to your list and mark it "found by
red team".

## Step 3: Write each abuse case as a test

For each threat:

- Write the attack as a concrete abuse case: who does what, through which
  entry point, to reach which asset.
- Write a test in the project's own test framework that performs it against
  local code. Assert the **safe** outcome (the forged approval is rejected,
  the payload renders as text, the key is not on disk).
- Run it. A **failing** test is a finding: the attack works. A **passing**
  test is evidence the control holds; keep it as a regression test.
- If a threat cannot be tested locally (it needs a real third-party service,
  another user account, or physical access), write down why and what
  evidence you have instead. Do not reach for a live target to make it
  testable.

Mark tests that are expected to fail until a fix lands so the suite stays
honest: use the framework's "known failure" mechanism (for example
`it.fails` in Vitest, `#[should_panic]` or an ignored test with a reason in
Rust) and name the finding ID in it. Never delete or weaken an existing test
to make room.

## Step 4: Report the findings

Write the report next to the threat model (for example
`docs/security/red-team-YYYY-MM-DD.md`):

| ID | Threat | Abuse case | Severity | Evidence | Test | Status |
|---|---|---|---|---|---|---|
| RT-1 | T2.1 | Agent appends a human approval to the event log | High | test fails: app accepts it | `path/to/test` | open |
| RT-2 | T4.1 | Script tag in a project name | — | test passes: rendered as text | `path/to/test` | control holds |

- Severity from impact on the assets in the threat model, not from how clever
  the attack is.
- Evidence is the test result or command output, not a description.
- Record each open finding in project memory as a problem (PRD SEC-4) so the
  gate shows it.

## Step 5: Hand over

Hand the report to the blue team and to the person. State plainly: how many
threats were tested, how many controls held, how many findings are open,
and which threats were not testable and why. Do not call the project secure.

## Red flags

- Any request, packet or login aimed at a host that is not part of the local
  project.
- Using a real key, token or account.
- A finding without a test or a written reason.
- "Mitigated" accepted without a test.
- Fixing the finding yourself.
- Deleting or weakening existing tests.

## Related skills

- `security-and-hardening`: threat modelling (STRIDE), the control catalogue.
- `security-review`: a checklist to sweep for common mistakes.
- `blue-team`: fixes, monitoring and the incident plan.
- `test-driven-development`: how to write the failing test first.
- `doubt-driven-development`: an adversarial second look at your own findings.

---

Written for OmniOrchestrator (Apache-2.0) from the project's requirements
(PRD SEC-1 to SEC-4, SEC-6). No text is copied from other sources.
