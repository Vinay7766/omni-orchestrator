---
name: stack-selection
description: Use in the architecture phase, or whenever someone asks "what should we build this with?", "which framework/language/database/hosting?", or wants to compare stacks. Asks for the project's constraints first, compares two or three genuinely different candidate stacks in a decision table, checks every version and support claim against current official documentation, and records the recommendation as an ADR with the reasons the others lost and what would change the decision. Never declares a universally "best" stack.
---

# Stack Selection

A stack is only good or bad for a set of constraints. The same choice that is
right for a solo developer shipping a desktop app in a month is wrong for a
regulated team running a multi-region service. This skill makes the
constraints explicit, compares real alternatives against them, and writes the
decision down so the next person (or agent) can see why it was made and when
to revisit it.

## When to use

- The architecture phase of a new project, before any scaffolding.
- Adding a major piece to an existing project (a database, a mobile client, a
  hosting platform, a message queue).
- Someone questions an existing choice: run the same steps and either confirm
  the old ADR or supersede it.

Skip it for choices the project has already fixed and nobody is questioning.

## Step 1: Ask for the constraints (before naming any technology)

Ask the person; do not guess. Use the list below as prompts, not a form, and
add whatever this project needs:

| Constraint | Example questions |
|---|---|
| Target platforms | Web, desktop (which OSes), mobile (iOS, Android), CLI, server, embedded? Offline use? |
| Users and scale | How many users at launch and in a year? Data size? Latency needs? |
| The team's skills | What do the people who will maintain this already know? Who maintains it after launch? |
| Budget | Licence costs, hosting costs, paid tools, developer accounts and certificates |
| Hosting and operations | Self-hosted, a specific cloud, serverless, user's own machine? Who is on call? |
| Licensing | The project's own licence; licences that are not allowed (for example copyleft in a closed product) |
| Timeline | First usable version when? Long-term support needed for how long? |
| Compliance and data | Personal data, payments, health data, data residency, accessibility requirements |
| Existing commitments | Code, services, vendors or contracts the stack must work with |

Write the answers down and **show them back for confirmation**. If the person
cannot answer one, record it as an assumption and say so in the ADR.

Then mark each constraint as a **hard filter** (a candidate that fails it is
out: "must run offline on Windows, macOS and Linux") or a **weighted
criterion** (more is better: "team already knows TypeScript").

## Step 2: Pick two or three genuinely different candidates

- Candidates must differ in kind, not in minor details (three web frameworks
  in the same language are one candidate with variations).
- Include the **simplest stack that could work** as a baseline, often the
  one the team already knows.
- Drop anything that fails a hard filter, and say which filter.
- Do not start from a favourite list. Names you or the person mentioned are
  examples of a category: look for other members of that category too.

## Step 3: Check the facts at the source

For every candidate, look up in its **official** documentation, release
notes or support policy (not blog posts, not memory):

- the current stable version, and its support or end-of-life date;
- platform support that matters to the hard filters;
- the licence of the framework and of anything it requires;
- any cost the constraints care about (pricing pages for hosted services).

Write each fact with its link and the date you read it. If a fact cannot be
verified, mark it **unverified** in the table instead of filling it in from
memory. Versions from training data are the most common way this step goes
wrong.

## Step 4: Decision table

One row per weighted criterion, one column per candidate. Each cell holds a
short piece of evidence, not just a score:

| Criterion (weight) | Candidate A | Candidate B | Candidate C |
|---|---|---|---|
| Team knows it (high) | 3 of 3 people use it daily | 1 of 3 | none |
| Offline desktop on 3 OSes (hard filter) | yes, [link] | yes, [link] | fails: browser only |
| Install size (medium) | ~10 MB, [link] | ~100 MB, [link] | n/a |

If the weights decide the outcome on their own, say so, and show what the
result would be with different but reasonable weights.

## Step 5: Recommend, honestly

- Recommend one candidate and say it is **the best fit for these
  constraints**, never "the best stack".
- State why each other candidate lost, in one or two sentences each.
- State the **switch conditions**: the concrete changes that would make
  another candidate the better choice ("if a web version becomes a
  requirement, B wins because ...").
- List the risks of the chosen stack and how the project will notice them
  early.

## Step 6: Record it as an ADR

Follow the project's existing ADR convention if there is one (location,
numbering, headings). Otherwise use `docs/decisions/ADR-NNN-<short-title>.md`
with this shape:

```markdown
# ADR-NNN: <Stack for ...>

## Status
Proposed (the person accepts or rejects it; never mark it Accepted yourself)

## Date
YYYY-MM-DD

## Context and constraints
<the confirmed constraints from Step 1, hard filters marked; assumptions marked>

## Options considered
<the decision table from Step 4, with links and the date the facts were read>

## Decision
<the recommendation, "best fit for these constraints">

## Why the others lost
<one or two sentences per candidate>

## Switch conditions
<what would change the decision>

## Consequences and risks
<what this commits the project to; how risks will be noticed>

## Sources
<every official page used, with the date read>
```

## Step 7: Stop for the person's decision

Do not install, scaffold or migrate anything until the person accepts the
ADR. If they choose a different candidate, record that choice and their
reason in the ADR; the decision is theirs.

## Red flags

- Naming a technology before asking about constraints.
- Only one real candidate, or three variations of the same one.
- Version numbers, support dates or prices without a link and a date.
- "X is the best/most popular/modern choice" as a reason.
- No switch condition.
- Scaffolding the project before the ADR is accepted.

## Related skills

- `documentation-and-adrs`: ADR conventions and lifecycle (superseding,
  never deleting).
- `source-driven-development`: how to check facts against official
  documentation.
- `solution-design`: the same "design it twice" habit at the level of a single
  task.
- `doubt-driven-development`: an adversarial review of the recommendation
  when the stakes are high.

---

Written for OmniOrchestrator (Apache-2.0) from the project's own requirements
(PRD STK-1 to STK-3). No text is copied from other sources.
