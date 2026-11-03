## Custom skills that reach every tool (SKL-5, SKL-6; tester feedback 4 and 8) (2026-11-03)

Spec approved by the owner 2026-11-03.

Problem: the Skills area saved edits and on/off switches only in the app's own files
(`custom_skills.json`, `skill_states.json`); the MCP server, which serves skills to every AI tool,
reads only the bundled `skills/` folder, so tools never saw them. There was no way to add a skill.

Constraints: one format for the app (Rust) and the server (Node); the bundled catalog's schema
and validators already exist; skills are instructions other AI tools follow, so a new one must
carry author, source and license (SKL-6) and never a secret (MEM-6); per-project overrides
(`.agents/skills.json`) keep working on top.

Approaches considered:
- A: a per-user "your skills" folder in the app's data folder, laid out like the bundled one:
  `catalog.json` (same schema) and `<id>/SKILL.md` for added or edited skills, plus `skills.json`
  (the skills-config schema) for on/off of any skill. The app writes it; the MCP server reads it
  over the bundled catalog (`--user-skills <folder>`, written into each tool's MCP entry by the
  app). Applies to every project.
- B: write skills into each project's `.agents/skills/`. Other AI tools keep their own files there,
  and a person's skills would not follow them to the next project.

Chosen: A. User entries replace bundled ones with the same id; content is read from the user
folder first. An unreadable or invalid user file is reported as an error naming the file, not
skipped silently (NFR-7).

Switch if: people want skills shared with a team through git (then add a per-project layer).

Slices: (1) core source and server argument; (2) the app reads and writes the folder, moving
the old files over once; (3) add or upload a skill in the Skills area.

Edge cases tested: no user folder (bundled only); a user skill added; a bundled skill edited
(user content wins); a skill switched off (not served); invalid user catalog (error names the
file); argument order and a missing folder value.

Generalisation check: no skill, tool or folder name is special; tests use made-up skills.

Assumptions to confirm: none.
