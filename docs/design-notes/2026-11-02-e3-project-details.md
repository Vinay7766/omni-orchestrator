## E3 slice 4b: a person changes the project's name or mode (2026-11-02)

Problem: APP-2 says the dashboard edits memory; the owner chose "view all, add entries", with the project's name and mode editable. project.json had no update path and no record of changes.
Constraints: every change must say who made it and when (MEM-3); only people change project settings; the project schema (name 1-200 chars, mode full/simple) must hold; a failed write must not leave a record of a change that did not happen.
Approaches considered:
- A: new human-only `project_updated` event; the store rewrites project.json atomically inside the lock as the event's effect, then records the event (the existing `appendEvent` effect pattern, used for design notes)
- B: keep project.json frozen and derive name/mode from events on every read (every reader of project.json changes; more moving parts)
Chosen: A, because it follows the established pattern and keeps project.json the one place readers look.
Switch if: project settings ever need history-aware reads (then B).
Rules: person only (store and event schema); values checked against the project schema; only changed fields are recorded; "nothing to change" refused; the store's cached project updates only after success; the summary is refreshed after (it shows the name).
Edge cases tested: rename + mode change, reopen sees the change, agent refused with nothing written, empty and over-long names refused with nothing written, no-op refused; fixtures (person valid; agent and empty payload invalid); app form sends only changed fields, never an empty name, explains simple mode; screen reloads with the new name.
Generalisation check: no named examples.
Not covered: flow cannot change (a different flow means a different project).
