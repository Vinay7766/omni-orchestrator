## D: tools and models first, then a task list built around them (2026-11-03)

Tester feedback 3 (owner: fix in v0.1): before the task list, scan the computer for AI tools,
ask which models the person uses in each, then build the task list so each task goes to the
tool and model that fit it best, hand each tool its own tasks, launch them, and give step-by-step
instructions. This brings the assignment part of TEAM-2 / TEAM-7 and the guide part of NTU-1
forward from v0.6 / v0.5; branches per tool, cross-agent review and quota pooling stay in v0.6.

Problem: the task list was written before any tool was chosen, so tasks carried only "kinds" and
every tool got the same next task; nobody told the person which tool should do what, or how.

Constraints: no fixed tool or model list (TOOL-0, TOOL-6): tools come from discovery, models are
typed by the person (read from a tool's config later, where an adapter knows how); the person
approves the task list, assignments included (GATE-2); the model's assignment is a suggestion,
validated against the person's own team (no tool or model outside it); schemas stay backward
compatible (all new fields optional).

Approaches considered:
- A: order the steps as the tester asked: after the architecture is approved, the person selects
  tools and enters the models they use in each (team.json); the task-list prompt includes that
  team; the model assigns each task a tool, a model and a one-line reason; the app checks every
  assignment against the team; the person approves the list with its assignments; each task is
  created with them (task_created payload, state). The handoff then gives each tool its own
  tasks, and a per-level guide says how to start in that tool.
- B: keep the task list first and match tasks to tools afterwards with fixed rules on "kinds".
  No model call, but it needs a hand-written rule table per kind of work, which is exactly the
  hard-coded knowledge TOOL-0 forbids, and it ignores the models the person uses.

Chosen: A.

Slices: (1) contract: team members' models, task assignment fields, state; (2) the team panel
before the task list, with models per tool; (3) the task-list prompt and its check of
assignments, shown for approval; (4) handoff per tool with its own tasks, "launch all", and
the step-by-step guide per capability level.

Switch if: tools start exposing their models in a readable config (then prefill models from
adapters), or v0.6 team mode needs reassignment after failures (TEAM-11: assignment becomes an
event of its own).

Edge cases tested: a team with one tool (every task goes to it); a model not in the team, or a
tool not in the team (refused, the person sees why); a tool with no models typed (assignment
without a model); old projects without assignments still load; the AGENTS.md block lists only
that tool's tasks.

Generalisation check: tools and models in tests are made up; nothing names a vendor.

Assumptions to confirm: none.
