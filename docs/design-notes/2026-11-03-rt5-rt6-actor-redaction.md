## RT-5 / RT-6: redact the actor before it is written (2026-11-03)

Problem: an event's `actor.tool` and `actor.model` are stored as given, so a key placed in a
model name (`submit_phase.model`, RT-5) or in an MCP client's own name (`clientInfo.name`, RT-6)
lands unredacted in `events.jsonl`, which every later tool reads and a person may commit (MEM-6,
NFR-2, threat T3.3).

Constraints: every event is written by one function, `MemoryStore.appendEvent` (core); the
desktop app, extension and MCP server all go through it. The actor schema allows 1-200 characters
for `tool` and `model`; the redaction marker (`[REDACTED:<kind>]`) is never empty.

Approaches considered:
- A: redact the actor in `appendEvent`, together with payload and refs (one `redactJson` call).
  One place covers every channel, including ones not written yet. Cost: one line.
- B: redact where the MCP server builds the actor (`clientInfo.name`, the `model` argument).
  Fixes the two found paths only; the extension, the app or a future channel could repeat it.

Chosen: A, because the store is the single write path and MEM-6 says secrets never enter memory,
whoever supplies them. Redaction findings from the actor count in `redactions` like any other.

Switch if: a channel ever writes events without the store (then that channel must redact too).

Edge cases tested: a key in `actor.model` (core unit test and RT-5 over MCP); a key in
`actor.tool` (core and RT-6 over MCP, through the client's name); an ordinary tool and model name
stays unchanged (existing tests keep exact actors); the redacted event still validates.

Generalisation check: no named tool, model or key format; the tests use made-up names and the
existing redaction patterns.

Assumptions to confirm: none.
