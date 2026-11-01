---
name: solution-design
description: Use before writing code for any non-trivial coding task — implementing a function, algorithm, feature logic, data processing, a bug fix whose cause is not yet known, or performance work. Forces understanding the problem, comparing 2-3 genuinely different approaches (complexity, risk, fit), choosing one with a stated reason, and planning edge-case tests before any code is written. Skip only for trivial edits such as renames, copy text or config values.
---

# Solution Design

You already know how to write clean code. What goes wrong is choosing the
approach: you code the first plausible idea, then patch around its flaws.
This skill makes you pick the right approach *before* coding, for every
non-trivial task.

This is per-task problem solving. Deciding *what* to build with the user
(requirements, product design) belongs to the discovery/brainstorming phase.
If the task turns out to be a product question, stop and go back there.

## When this applies

| Task | What to do |
|------|------------|
| Trivial (rename, change text, bump a config value) | Say "trivial, no design note" and do it. |
| Small (one function, a clear bug) | Short design note: steps 1-5 in a few lines each. |
| Medium (new logic across a few files, anything with performance or data-size concerns) | Full design note. |
| Large (new subsystem, cross-cutting change) | Stop. This needs an architecture decision, not a task note. Escalate to the architecture phase. |

When unsure between two sizes, pick the larger one.

## Step 1: Understand the problem

Do not propose any solution yet.

1. **Restate it in one sentence**, in your own words.
2. **Inputs and outputs:** exact shape and types, where they come from, where
   they go.
3. **Constraints**, with numbers wherever you can get them:
   - data size (how large can n get, in practice and in the worst case)
   - time or latency budget
   - memory limits
   - concurrency (can this run twice at once? partially fail?)
   - platform limits (OS, runtime, network, API rate limits)
4. **Work two concrete examples by hand:** one normal case and one edge case.
   If you can't do it by hand, you don't understand it yet.
5. **Unknowns:** list them. For each, either look it up (code, docs, data) or
   state the assumption you are making and flag it to the user. Never fill a
   gap silently.
6. **Generalisation check:** does the task mention named examples (tools,
   models, providers, formats, platforms) or one scenario? If the confirmed
   requirement is about a whole category or a general need, the design must
   handle members nobody named, without listing the named ones in code.
   If you don't know whether a list is complete, ask (the `understand-intent`
   skill covers how) instead of hard-coding it.

## Step 2: Look for what already exists

Before designing anything new:

- **This codebase:** search for an existing function, pattern or utility that
  already does it or most of it. Reuse beats reinvention.
- **Standard library and existing dependencies:** prefer them over hand-rolled
  code, especially for parsing, dates, crypto, concurrency and sorting.
- **Known problem class:** name it if it matches one. Examples: search or
  lookup, sorting or top-k, intervals, graph traversal or shortest path,
  dynamic programming, sliding window or two pointers, union-find, caching,
  state machine, producer/consumer, retry with backoff, diff or merge.
  Recognising the class usually brings a proven solution with known complexity.

## Step 3: Generate 2-3 genuinely different approaches

"Design it twice." Always consider at least two approaches that differ in
kind, not in minor details. One of them should be the **simplest correct
baseline** (often brute force), because it is the yardstick for the others.

For each approach, write:

- **Idea:** two lines at most.
- **Complexity:** time and space, derived from the constraints in Step 1.
  Say whether it is worst case or typical.
- **Failure modes:** what breaks it (huge input, bad input, partial failure,
  race condition, precision).
- **Cost:** implementation effort and how much existing code it touches.
- **Fit:** how well it matches the codebase's patterns and the project's
  architecture decisions.

Drop approaches that violate a constraint or the project's architecture
rules, and say why you dropped them. If there is genuinely only one sensible
approach, say so and explain why the alternatives don't fit. Don't invent
weak options just to fill the list.

## Step 4: Decide

- **Rule:** choose the *simplest approach that meets every constraint*.
  Extra speed or flexibility the constraints don't require is cost, not value.
- State the choice and the deciding reason in one or two sentences, tied to a
  specific constraint ("n reaches 10^6, so the O(n^2) baseline is too slow;
  the hash-map approach is O(n) and fits the 200 ms budget").
- State **what would make you switch**: "If memory becomes the limit, move to
  approach B."
- If the decision depends on something only the user knows (a trade-off
  between speed and cost, for example), ask before coding.

## Step 5: Plan edge cases and tests before writing code

List the cases the code must handle, then write the tests first (use the
test-driven-development skill if it is available). Consider at least:

- empty input, a single element, and the maximum expected size
- duplicates, ordering, and ties
- invalid or malformed input, and wrong types
- boundaries: zero, negative, off-by-one, overflow, float precision
- text: Unicode, whitespace, very long strings
- external failures: network down, timeout, partial response, rate limit
- concurrency: the same operation running twice, or interrupted halfway

Every edge case from Step 1's hand-worked examples must become a test.

## Step 6: Record the design note

Save a short note in the project memory (for example
`.agents/design-notes/<date>-<task>.md`, or wherever the project keeps
decisions) so other tools and later sessions know *why* the code looks the
way it does:

```markdown
## <task name> (<date>)
Problem: <one sentence>
Constraints: <sizes, budgets, limits>
Approaches considered:
- A: <idea> (time/space; main risk)
- B: <idea> (time/space; main risk)
Chosen: <A or B>, because <deciding constraint>
Switch if: <condition>
Edge cases tested: <list>
Generalisation check: <categories handled, how unnamed members are covered, the made-up-member test; or "no named examples">
Assumptions to confirm: <list, or "none">
```

For a small task, this can be four or five lines.

## Step 7: Implement, then look back

1. Implement the chosen approach, keeping to the minimal change that solves
   the problem.
2. Run the tests. Re-check the two hand-worked examples from Step 1.
3. **Compare prediction with reality.** If performance mattered, measure it.
   If the result differs from what you predicted in Step 3, say so.
4. **If the approach turns out to be wrong, go back to Step 3.** Do not patch
   around a wrong approach; that is how fragile code is made. Update the
   design note with what you learned.

## Honesty rules

- Complexity claims must come from reasoning about the code. If you didn't
  measure performance, write "estimated", not a number that looks measured.
- Never say tests pass unless you ran them in this session and saw the
  result. If you couldn't run them, say so.
- Never present an assumption as a fact. Label it and tell the user.
- If no approach meets the constraints, say so plainly and explain which
  constraint would have to change. Do not ship something that silently
  violates one.

## Red flags

| Thought | Reality |
|---------|---------|
| "The approach is obvious, I'll just code it" | Obvious approaches fail at scale and on edge cases. Write two lines on the alternative you are rejecting. |
| "I'll optimise it properly from the start" | Only if a constraint demands it. Otherwise the simplest correct approach wins. |
| "I'll handle edge cases after it works" | Edge cases decide the approach. Plan them in Step 5, before coding. |
| "The test is failing, so I'll add a special case" | A pile of special cases means the approach is wrong. Go back to Step 3. |
| "I'll assume the input is always valid" | State the assumption and get it confirmed, or validate the input. |
| "The user named these three, so I'll support these three" | Named items are usually examples of a category. Design for the category and test with a made-up member, unless the user confirmed the list is complete. |
| "It's probably O(n log n)" | Derive it or label it as an estimate. |

## Credits

The method draws on George Pólya's *How to Solve It* (1945): understand the
problem, devise a plan, carry it out, look back. It also uses John
Ousterhout's "design it twice" principle from *A Philosophy of Software
Design* (2018). The habit of laying out 2-3 approaches before building is
also central to the `brainstorming` skill in
[obra/superpowers](https://github.com/obra/superpowers) (MIT), which handles
the requirements level that this skill deliberately leaves out. No text is
copied from these sources.
