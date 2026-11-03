## P-E4-01 / P-E4-02: a skill change that fails is shown as failed (2026-11-03)

Problem: in the Skills area, a failed save of a skill edit still put the edit in the list, and a
failed on/off change still showed the switch in its new position (the error was swallowed). Both
break the honest-UI rule (NFR-7: no fake data, failures show the real error).

Constraints: `update_skill_content` and `toggle_skill` are local Tauri commands (fast, but can
fail: file write, unknown skill id). The edit dialog already waits for the save before leaving
edit mode. The person's typed text must not be lost when a save fails.

Approaches considered:
- A: App changes the list only after the command succeeds; on failure it re-throws. The edit
  dialog shows the error and stays in edit mode with the text kept; the catalog shows a toggle
  error above the list. Errors appear where the person acted. Small change in three files.
- B: optimistic update with rollback and a global error banner in App. Feels faster, but the
  commands are local and quick, and a rollback is more state to get wrong; the banner is far from
  the action.

Chosen: A, because the commands are local (no visible wait to hide) and it is the simplest way to
never show a state that was not saved.

Switch if: a command becomes slow enough that the switch feels unresponsive (then show a pending
state, still without claiming success).

Edge cases tested: toggle fails (switch keeps the saved state, error shown with the backend's
message); toggle succeeds (switch moves); save fails (error in the dialog, still editing, typed
text kept, list unchanged after closing); save succeeds (existing behaviour, list updated).

Generalisation check: no named examples; any skill and any error message.

Assumptions to confirm: none.
