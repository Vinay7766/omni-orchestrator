---
name: understand-intent
description: Make sure you understand what the user really means before planning, specifying or building anything - especially the depth behind their words. Use at the start of every planning phase (idea review, research, requirements/PRD, architecture), whenever a request names examples ("tools like X and Y", "for example", "etc."), describes one scenario that stands for a broader need, or when the user corrects how you understood them. Produces an Understanding check the user confirms, so examples are not mistaken for complete lists and single cases are not mistaken for the whole requirement.
---

# Understand Intent

The most expensive mistakes happen before any work starts: the request is
read too literally. A user lists three tools as examples and gets a product
that supports exactly those three. A user describes one situation and gets a
feature that only handles that situation. The words were followed; the
meaning was missed.

This skill makes the meaning explicit and gets it confirmed before anything is
planned or built.

## When to use it

- At the start of every planning phase: idea review, research, requirements,
  architecture.
- Whenever a request contains lists, names, or "for example".
- Whenever the user describes one scenario ("when I hit a rate limit and move
  to another editor...").
- Whenever the user corrects your understanding. Treat that as the most
  important signal in the conversation.

Skip it only for small, fully specified tasks ("rename this variable").

## Step 1: Restate the request in your own words

Write two to five sentences covering what they want, who it is for, and why
they want it, as far as they've said. Use plain words and avoid jargon they
didn't use. If you can't fill in "why", that is your first question.

## Step 2: Separate what was said from what you inferred

List the points the user actually stated. Then list what you are filling in
yourself. Everything in the second list is a guess until confirmed, however
obvious it feels.

## Step 3: Examples or a complete list?

For every list or named item in the request, decide which it is:

| Signals it's **examples of a category** | Signals it's **a complete list** |
|---|---|
| "like", "such as", "for example", "e.g.", "etc.", "and so on", "..." | "only", "exactly", "just these", "these three" |
| A few items from a large or growing category (editors, AI models, cloud providers, payment methods, file formats) | A fixed set by nature (days of the week, the user's own three products) |
| Items from different vendors that share a purpose | A contract, regulation or spec that enumerates the items |
| The user's goal makes sense for any member of the category | Adding another member would break the user's goal |

When the signals point to a category:

- **Name the category explicitly**: "AI coding tools of any kind", not
  "Antigravity, VS Code and Kiro".
- **Write the requirement for the category.** The named items become examples
  and test cases, not the definition.
- **Design for members nobody named yet**, including ones that don't exist
  yet. Ask how a new member would be found or added (discovery, a data file,
  a setting) rather than listing members in code.

When the signals are mixed or weak, **ask**: "You mentioned A, B and C. Should
this work for any similar X, or exactly these?" Never decide silently.

## Step 4: One scenario or the general need?

A single scenario is usually one instance of a broader need. Ask what the
scenario has in common with its neighbours:

- "When I hit my rate limit in one editor and switch to another" is really
  "switching tools for any reason, between any tools, without losing context".
- "Pitch my idea to a company by email" is really "take an idea to the right
  decision-maker through a channel that accepts it".

State the general need and the scenario it came from, and check the general
version with the user. Generalise to what the user meant, not beyond it: if a
broader reading would change cost or scope a lot, ask before adopting it.

## Step 5: Find the deeper goal

Ask why the user wants this, and what would make them say "that's not what I
meant" even if every stated requirement were met. Record that goal; it is the
yardstick for every later decision. A design that meets the words but misses
the goal is wrong.

## Step 6: List assumptions, ranked by impact

For each remaining assumption, note what changes if it's wrong. Ask about the
high-impact ones now, in one batch, each with your best guess attached so the
user can just confirm or correct. Low-impact ones can be stated as defaults.

## Output: the Understanding check

Present this to the user before writing any plan, spec or design, and wait
for confirmation:

```markdown
## Understanding check

**What you want, in my words:** <2-5 sentences: what, for whom, why>

**What you said:** <bullet list of stated points>
**What I'm inferring:** <bullet list of guesses>

**Examples and the categories I think they stand for:**
| You said | I think you mean | Complete list or examples? |
|----------|------------------|----------------------------|
| Antigravity, VS Code, Kiro | any AI coding tool, including future ones | examples |

**Single scenarios and the general need:**
| Scenario you described | General need I think it stands for |
|------------------------|------------------------------------|

**The deeper goal:** <one sentence>

**Assumptions** (highest impact first): <assumption - what changes if wrong>

**Questions:** <only the ones that change what gets built>

Please confirm or correct any of this before I continue.
```

## Step 7: Treat corrections as lessons

When the user corrects you:

1. Say plainly what you misunderstood and why, without defending it.
2. Update the Understanding check and re-confirm.
3. **Generalise the lesson**: if you read one list too literally, check every
   other list in the request and in existing documents for the same mistake.
4. Record the lesson where every later phase and every tool working on the
   project will see it (for example, the project's memory or lessons file),
   so it isn't repeated after a handoff.

## Step 8: Carry the understanding into the work

- Requirements are written at the confirmed level (category, general need).
- Designs show how unnamed members of each category are handled.
- Tests include at least one **made-up member** of each category, proving
  nothing depends on the named examples.
- Reviews check the delivered work against the confirmed understanding and the
  deeper goal, not just the literal wording.

## Worked example (a real mistake)

**Request:** "Users might have IDEs like Antigravity, VS Code, Kiro, Kilo Code,
OpenCode, Genspark..."

**What went wrong:** the plan listed eight "adapters at launch" for the named
tools, and the code already used a fixed six-tool list. The user had to point
out that they meant *all kinds of AI coding tools*, and that hard-coding the
named ones missed the real depth of the requirement.

**What the Understanding check would have produced:**

| You said | I think you mean | Complete list or examples? |
|----------|------------------|----------------------------|
| Antigravity, VS Code, Kiro, Kilo Code, OpenCode, Genspark | any AI coding tool on the user's machine, including ones released later, browser-based ones included | examples ("like", "...", six vendors, fast-growing category) |

**Resulting requirement:** discover tools by category (any editor built on a
shared base, any command-line agent, any tool with an agent configuration
file), integrate each at the best level it supports, and prove it with a test
that uses a made-up tool.

## Red flags

| Thought | Reality |
|---------|---------|
| "They listed these tools, so I'll support these tools" | Lists of examples define a category. Ask or generalise. |
| "The scenario is clear, I'll build for it" | One scenario is one instance. Find the general need. |
| "It's obvious what they meant" | Obvious to you is an inference. Put it in "What I'm inferring". |
| "Asking will annoy them" | One batched question costs seconds; a wrong build costs days and trust. |
| "I'll generalise everything to be safe" | Over-generalising inflates scope. Generalise to what they meant, and confirm big jumps. |
| "They corrected one thing, I'll fix that one thing" | Corrections reveal a pattern. Check everywhere else for the same mistake. |

## Credits

Written for OmniOrchestrator (Apache-2.0), from a misunderstanding that
happened while building it. It complements `interview-me` (finding intent
through questions) and `brainstorming` (agreeing a design); this skill focuses
on reading examples, scenarios and corrections at their real depth. No text is
copied from other sources.
