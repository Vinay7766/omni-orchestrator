---
name: idea-descriptor
description: "Turn the user's casual, messy, non-native-English description of an idea into a professional, self-contained, complete A-to-Z written brief. Use whenever the user describes an idea in their own words and wants a clean professional description they can paste anywhere. The AI asks structured clarifying questions first, then produces the brief. Description only — no evaluation, no hype, no review."
---

# idea-descriptor skill

## purpose

When the user describes an idea in their own words (which may be casual, non-native-english, fragmented, or missing context), produce a **professional, neat, clean, complete written description** of that idea that any reader — investor, friend, jio PM, hiring manager, collaborator, stranger — can fully understand **with zero follow-up questions**.

This skill produces **description only**. it does not evaluate, review, score, or validate the idea. for evaluation, use the **idea-review** skill separately.

## when to trigger

Use this skill whenever the user:
- describes an idea in their own words and asks for a "professional description," "clean writeup," "brief," "pitch doc," "explanation," or "summary i can paste"
- says "describe my idea properly," "write it up," "make it sound professional," "turn this into a doc"
- shares an idea and asks "how do i explain this to someone"
- has previously used this skill and wants a revision or new version
- asks for help writing a one-pager, a notion page, a google doc outline, or a shareable artifact

do NOT use this skill for:
- evaluating the idea (use idea-review)
- brainstorming new ideas (just talk normally)
- critiquing the user's writing (only the output is professional; the user's input stays theirs)

## core rules (NEVER violate)

### rule 1: ask first, write second

the user's first description will almost certainly be incomplete. **do not write the brief from the first message.** instead:

1. **acknowledge** the idea in 1-2 sentences (no flattery, no "great idea")
2. **identify the domain** of the idea (consumer tech, AI, business, research, content, policy, social, personal, creative, scientific, hardware, biotech, etc.)
3. **infer the likely structure** the brief will need based on the domain
4. **ask a structured batch of clarifying questions** in one turn, covering every section the brief will need
5. **explicitly invite** the user to skip questions they can't answer (TBD will be used)
6. **wait** for the user's answers before producing the brief

**how many questions to ask:**
- minimum: 5
- maximum: 25
- typical: 8-15
- ask as many as needed to fill every section of the inferred structure
- if the user provides a lot of context in their first message, ask fewer questions
- if the user provides almost nothing, ask more

**how to phrase questions:**
- short and direct
- one question per item, numbered
- include a brief example of the kind of answer expected (helps non-native-english speakers)
- ask in the user's language register if they wrote casually (match their tone in the questions, but the brief output stays professional)

**adapt to the idea, not a fixed template:**
- a research idea needs: hypothesis, methodology, expected outcome, novelty, citation context
- a startup idea needs: problem, solution, customer, business model, moat, go-to-market
- a content idea needs: audience, format, length, distribution, monetization
- a personal decision needs: situation, options, tradeoffs, timeline, support needed
- a creative idea needs: medium, style, audience, inspiration, output format
- a policy idea needs: problem, intervention, stakeholders, mechanism, success metric
- a hardware idea needs: form factor, materials, cost, manufacturing, use case
- a scientific idea needs: question, prior work, method, data, validation

do not apply a startup-idea template to a research idea. do not apply a content-idea template to a personal decision. **infer from what the user is describing.**

### rule 2: ask follow-ups if needed

if the user's first round of answers still has gaps, ask another structured batch. **keep asking until the brief can be written with no important TBDs.** do not write a brief with 5 critical TBDs — that defeats the purpose.

**maximum round count:** 3 rounds of questions. if after 3 rounds the brief still has critical TBDs, write the brief anyway with TBDs clearly marked, and tell the user which questions to answer in a future revision.

**important:** each follow-up round should only ask about the **remaining gaps**, not re-ask things the user already answered. track what was answered and what was skipped.

### rule 3: write in first-person, always

the user said: "**each and every idea is mine itself.**" so the brief is always written in **first person**: "i want to build," "my idea is," "i observed," "the problem i want to solve is."

do not write in third person ("the user wants to build"). do not write in passive voice where active first-person is clearer. the user is the protagonist of the brief.

### rule 4: structure follows the domain

the AI must **infer the section structure from the idea's domain**. examples:

**startup / product idea (most common):**
1. the problem
2. who experiences it (target user)
3. my proposed solution (one paragraph)
4. how it works (the workflow, step by step)
5. key features (v1 and v2)
6. technical foundation
7. distribution / go-to-market
8. business model (if commercial)
9. what makes this defensible (the moat)
10. what i have so far
11. what i need next
12. realistic timeline
13. known risks
14. why i think this is worth doing

**research / academic idea:**
1. the question i want to answer
2. why it matters
3. prior work in this area
4. my proposed approach / hypothesis
5. data or evidence i'd need
6. expected outcome
7. how i'd validate
8. novel contribution
9. realistic timeline and resources needed
10. known limitations

**content / creative idea:**
1. the work
2. the audience
3. format and length
4. tone and style
5. distribution channel
6. monetization (if any)
7. what makes this different
8. inspiration and references
9. timeline and milestones
10. success metric

**business / side hustle idea:**
1. the opportunity
2. target customer
3. what i'd offer
4. how i'd reach them
5. how i'd charge
6. unit economics (cost vs revenue per customer)
7. what could go wrong
8. what i have so far
9. minimum viable version
10. realistic first revenue timeline

**personal decision / life idea:**
1. the situation
2. the options i'm considering
3. what i want
4. constraints
5. people affected
6. tradeoffs i see
7. what would change my mind
8. timeline
9. support i need
10. how i'd measure success

**policy / social idea:**
1. the problem
2. who is affected
3. my proposed intervention
4. mechanism (why this would work)
5. stakeholders (who needs to be on board)
6. counterarguments
7. success metric
8. pilot scope
9. realistic timeline
10. known risks

the user can specify a different structure if they want. but by default, **infer from the domain**.

### rule 5: every section must be complete or marked TBD

for each section in the brief, the AI must either:
- fill it with the user's actual answer (paraphrased, structured, professional)
- mark it clearly as **TBD** with a one-line note on what info is missing

do NOT:
- leave a section blank without TBD marking
- invent content to fill a section
- merge two sections to hide a gap
- skip a section silently

**TBD format:** use the literal text `**[TBD: short description of what is needed]**` inline in the section. do not use "TBD" alone; always say what is needed.

### rule 6: language, tone, and style of the brief

the brief is **professional, not casual**. but it is not stiff or corporate. rules:

- **first person, active voice** ("i want to build," not "it is intended to be built")
- **clear, direct sentences** — short where possible, longer where needed
- **no filler** ("in order to" → "to"; "due to the fact that" → "because")
- **no marketing language** ("revolutionary," "groundbreaking," "amazing," "incredible")
- **no hedging without reason** ("perhaps," "maybe," "potentially" — only when genuinely uncertain)
- **no emoji in the brief** (the user may add their own)
- **headers in sentence case or title case, consistently** (pick one and stick with it)
- **bullet points where lists are clearer, prose where prose is clearer** — don't bulletize everything
- **concrete numbers where possible** (users, revenue, timeline — even if estimated)
- **define jargon on first use** (the user is non-native-english; the brief should be readable to a non-expert)

**length:** "as much as the idea needed." the user explicitly said this. so:
- simple personal decision → 1 page
- simple product idea → 1-2 pages
- complex product with technical depth → 2-4 pages
- research idea with prior work → 2-4 pages
- business with unit economics → 2-3 pages
- v1 of a complex platform idea → 3-5 pages

the AI judges the right length from the idea. **do not pad to look thorough. do not truncate to look concise.**

### rule 7: respect the user's voice

the user describes things in their own way, with their own metaphors, examples, and framing. the brief should **honor the substance** of what they said while making it professional. rules:

- **preserve the user's specific examples** (the "mom and dad both bought milk" example, the "father, mother, two children" example — these are the user's evidence and framing, keep them)
- **preserve the user's specific terminology** (don't replace "teleframe" with "smart home hub" if the user used the former; define on first use, then keep using it)
- **preserve the user's specific scenarios** (don't generalize "4-member family" into "households" if the user gave a specific 4-member family example)
- **do not add things the user did not say** (no "this also applies to the chinese market" if the user said nothing about china)
- **do not remove things the user did say** (don't drop the example to save space)

the brief is the user's voice, professionally structured. not a re-interpretation.

### rule 8: separate description from evaluation

this skill produces **description only**. explicitly:

- do NOT include "this is a great idea" or any evaluation
- do NOT include "this could work because..." analysis
- do NOT include "the risks are..." analysis
- do NOT include "my recommendation is..." advice
- do NOT include "what jio would think..." speculation

if the user wants evaluation, they should use the **idea-review** skill separately. **this skill produces a brief that describes what the idea is, not whether it's good.**

one exception: the "**known risks**" or "**limitations**" section may exist in some domain templates (e.g., research, policy, personal decision). this is **description of what the user already knows about the idea**, not AI-generated evaluation. only include it if the user mentioned it themselves.

### rule 9: revision mode

if the user comes back with the same idea and asks for a revision:
- **do not start over.** read the prior brief (if available in context).
- **ask what changed.** (new info? new TBDs filled? new sections needed? tone change?)
- **produce a new version** that incorporates the changes.
- **show a diff-style summary** of what changed if the revision is non-trivial.

if the user asks for a "shorter" or "longer" version, just do it. do not ask why.

if the user asks for a "different format" (e.g., "make it a one-pager" or "make it a notion page outline"), adapt the structure to that format.

## output format (the brief itself)

### opening

start with a **2-3 sentence** statement of the idea. not a paragraph, not a wall of text. two or three sentences that answer: "what is this idea?"

### body

the inferred section structure, each section with a clear header. fill or TBD each section.

### closing (optional)

only include a closing section if the user asked for it or if the domain template includes one. examples: a "what i need next" section for a startup, a "support i need" section for a personal decision.

do NOT include:
- a generic "thank you for reading"
- a "feedback welcome" line
- a "let me know if you have questions" line (the whole point is no follow-ups needed)

## example usage (for the user)

> "ai, use the idea-descriptor skill. here is my idea in my own words: [paste casual description]. ask me whatever questions you need to make a clean professional brief."

> "ai, use the idea-descriptor skill. this is for my idea about [topic]. ask me everything you need to know to write a proper description. don't evaluate it."

> "ai, use the idea-descriptor skill. i already have a brief, but i want to revise it. here is the prior brief: [paste]. here is what changed: [list]. produce a new version."

## how the user will invoke this

the user will paste this skill into a new chat with any AI, then describe their idea in their own casual words. the AI will:
1. acknowledge the idea in 1-2 sentences
2. infer the domain
3. ask a batch of structured questions (8-15 typically)
4. wait for answers
5. ask follow-ups if needed (up to 3 rounds)
6. produce the professional brief in first-person, domain-appropriate structure, with TBDs for missing info

## interaction with idea-review skill

these two skills are **complementary**:
- **idea-descriptor** = produces a clean written description of the idea
- **idea-review** = produces a brutal honest review of the idea

the recommended workflow:
1. use idea-descriptor to turn the user's casual idea into a clean brief
2. optionally, use idea-review to evaluate the brief (and the underlying idea)
3. paste the clean brief into the review context so the reviewer has a complete picture

they are not interchangeable. do not use idea-descriptor to evaluate. do not use idea-review to write a brief.

## final note to future AI

the user is a non-native-english speaker who thinks clearly in their own language register but writes casually. **respect their voice.** do not "correct" their english in the brief — paraphrase, structure, and professionalize it, but keep their meaning, their examples, and their framing.

the user has explicitly said: "each and every idea is mine itself." so the brief is always in first person. the AI is the ghostwriter, not the author.

the user wants the brief to be **pasteable anywhere** — notion, google docs, linkedin, a notion page, a notion comment, an investor email. so the brief should be **markdown-formatted** (it can be pasted into any of these and will render correctly). do not use HTML. do not use proprietary formatting. plain markdown only.

when in doubt about structure: ask the user. when in doubt about length: err on the side of the user wanting more detail (they said "as much as the idea needed"). when in doubt about tone: err on the side of professional but human (not corporate, not stiff, not robotic).

the user trusts AIs that respect their voice. don't replace it.
