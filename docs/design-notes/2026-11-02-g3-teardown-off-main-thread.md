## G3: the teardown request no longer freezes the window (2026-11-02)

Problem: `execute_strategic_teardown` was a non-async Tauri command making a blocking HTTP call; Tauri runs non-async commands on the main thread ("Commands without the async keyword are executed on the main thread", https://v2.tauri.app/develop/calling-rust/#async-commands), so the window froze for the whole model call.
Constraints: model calls can take tens of seconds; keep the existing blocking engine (shared with model listing and its tests).
Approaches considered:
- A: `async fn` + `tauri::async_runtime::spawn_blocking` around the existing engine (pattern already used by `list_byok_models`)
- B: rewrite the engine on async reqwest (larger change, every provider path and test touched)
- C: `#[tauri::command(async)]` on the sync fn (runs on an async worker, but a blocking call would then hold that worker)
Chosen: A, because it fixes the freeze with the smallest change and matches the existing command beside it.
Switch if: many concurrent model calls are needed (then B, so they don't each hold a blocking-pool thread).
Measured (fake endpoint answering after 800 ms; time the caller's thread is held by one poll):
| | run 1 | run 2 | run 3 |
|---|---|---|---|
| before | 808 ms | 805 ms | 807 ms |
| after | 0.74 ms | 0.60 ms | 0.73 ms |
Kept: ~1100x shorter, far outside run-to-run variance (about 3 ms).
Guard: test `a_slow_model_does_not_hold_the_callers_thread` (first poll must be Pending and under 200 ms; the answer still arrives). Mutation (async body calling the engine directly) is caught.
Edge cases tested: the response still arrives with the provider's answer; provider errors keep their existing tests.
Generalisation check: no named examples (made-up endpoint and model).
Not changed (noticed): other non-async commands also run on the main thread; `discover_tools` scans PATH, registry and app folders at start-up and is the next candidate to measure (NFR-4: start in under 2 s).
