---
name: blue-team
description: Use after a red-team pass to respond to its findings: fix each one test-first, or record it as a risk the person accepts; add the monitoring that would show the attack happening; write or update the incident response plan; and re-run every red-team test. Use when asked to fix security findings, harden after a red-team report, write an incident plan, or close out the security pass before release.
---

# Blue Team

The red team proved where the project breaks. The blue team makes those
proofs pass, makes the next attack visible, and leaves a plan for when
something still gets through. Its output is evidence, not reassurance: green
red-team tests, monitoring that fires, an incident plan a person can follow.

## Rules

1. **Every finding ends in one of two states:** fixed (its red-team test now
   passes) or **accepted risk recorded by the person**. You may recommend
   accepting a risk; you never accept one yourself.
2. **Fix the cause, not the test.** A red-team test may be changed only when
   it is wrong (it tests the wrong thing); say why in the commit and have the
   red team or the person agree.
3. **Same scope as the red team:** own project, local, no real secrets, no
   live third-party targets.

## Step 1: Triage

Read the red-team report and threat model. Order findings by severity, then
by how cheap the fix is. For each, decide with the person when a choice is
theirs (a fix that changes behaviour users see, adds cost, or removes a
feature).

## Step 2: Fix test-first

For each finding you fix:

1. Run its red-team test and see it fail (the finding still reproduces).
2. Remove the "known failure" marker so the test expects the safe outcome.
3. Fix the cause in the code (follow `security-and-hardening` for the
   control; prefer removing the attack surface over filtering input).
4. Run the test and see it pass; run the whole suite.
5. Commit the fix with the finding ID.

If a finding cannot be fixed now, write the risk in plain words for the
person: what can happen, how likely, what it would cost to fix, and what you
recommend. Record their decision (accept, defer to a named task, or fix now)
in project memory as a decision. Keep the test, marked as a known failure
that names the decision.

## Step 3: Make attacks visible

For each threat in the model, ask: if this attack happened in real use, how
would anyone notice? Add the smallest useful signal:

- a log line or event at the point a control rejects something (rejected
  approval, refused endpoint, redacted secret), without logging the secret
  itself;
- a warning the person sees in the app (for example "this approval is not
  signed");
- a check in CI that fails when a protection is removed.

Test that each signal fires (`observability-and-instrumentation` covers how).

## Step 4: Incident response plan

Write or update the plan (for example `docs/security/incident-response.md`),
short enough to follow under stress:

- **What counts as an incident** for this project (leaked key, forged
  approval found, malicious skill or dependency, data exposed).
- **First hour:** who decides, how to stop the damage (revoke and rotate keys,
  disable the affected feature or release, pin or remove the dependency),
  how to keep evidence (copy the event log before changing anything).
- **Telling people:** who must be told and how fast (users, the provider of a
  leaked key, anyone whose data is involved; check the law that applies with
  `compliance-check`).
- **Afterwards:** a blameless postmortem (`incident-response` skill), a
  red-team test that reproduces the cause, and an update to the threat
  model.

## Step 5: Re-run and report

Re-run every red-team test and the full suite. Report to the person:

| Finding | Severity | Outcome | Evidence |
|---|---|---|---|
| RT-1 | High | Fixed in `<commit>` | test passes |
| RT-3 | Medium | Accepted by the person on `<date>`: `<reason>` | known-failure test names the decision |

Update the threat model's status column. The security pass is done when every
finding is fixed or accepted by the person, the incident plan exists, and all
non-accepted red-team tests pass. Say what is still open; do not call the
project secure.

## Red flags

- A finding marked "accepted" without the person's recorded decision.
- A red-team test deleted, skipped without a reason, or loosened to pass.
- A fix with no test that failed before it.
- Monitoring that logs the secret it is protecting.
- An incident plan nobody but the author could follow.

## Related skills

- `red-team`: produces the findings and tests this skill answers.
- `security-and-hardening`: how to implement each control.
- `incident-response`: running an incident and its postmortem.
- `observability-and-instrumentation`: making attacks visible.
- `test-driven-development`: failing test before the fix.

---

Written for OmniOrchestrator (Apache-2.0) from the project's requirements
(PRD SEC-3, SEC-4). No text is copied from other sources.
