## Issue B: files are the source of truth; tool updates are merged, never reset (2026-11-04)

Problem (owner's v0.1 issues): statuses went back to "todo" after a refresh, work recorded by a
tool did not show, and what the person had typed was lost when the app closed.

Root causes found:
1. A valid but out-of-date state.json (it does not end at the event log's last event: a tool
   appended without the snapshot, or a crash came between the two writes) was trusted; the next
   write applied on top of it, so the other event's effect was lost from the snapshot.
2. A tool without MCP had no sanctioned way to report progress (ARCHITECTURE's "file-based
   progress updates" was never built): it recorded nothing, or edited memory files by hand; a hand
   edit that left state.json invalid made the next read rebuild it from the log, back to "todo".
3. The idea conversation and conversations on documents lived only in the page.

Constraints: events.jsonl stays the one source of truth (D2, D3); every update a tool reports
goes through the same rules as MCP (TaskEngine, PhaseEngine), as that tool; nothing a tool reports
is dropped silently; no network port (SYNC-2).

Approaches considered:
- A: (1) a snapshot is used only if its lastEventId is the log's last event, else rebuilt;
  (2) `.agents/task-updates.jsonl`: one JSON line per step, the same fields as the MCP tools;
  the app takes the file (rename first, so a tool appending meanwhile starts a new one) and
  applies each line on load and refresh; a refused or unreadable line becomes a problem with the
  reason; the page's live watcher also notices the file; (3) the app's unsaved drafts in
  ui-state.json in its data folder, read on start, never written before that read.
- B: let tools edit state.json and merge it with the log. Two sources of truth, and any tool could
  set any status (including approvals), which breaks the gates.

Chosen: A.

Switch if: tools gain MCP everywhere (the file stays as the fallback), or the log grows large
enough that reading it on every state read is slow (then cache the last event id, P-E7-04).

Edge cases tested: an event appended by another tool shows and survives the next write; design,
start and completion applied in order as the tool; a completion with failing tests refused and
recorded; a line that is not JSON recorded; the build handed in from a line; lines written
between two imports are applied next time; the page reloads within 2 s of a new update file;
drafts saved and read back; invalid or oversize drafts refused; no save before the first read.

Generalisation check: no tool is named; any tool can write the file.

Assumptions to confirm: none.
