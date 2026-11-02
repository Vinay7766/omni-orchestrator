## G2: BYOK settings survive restarts; keys only in the OS credential store (2026-11-02)

Problem: BYOK settings lived only in the screen's memory and were lost on restart; the settings model also carried API keys in a struct written to a plain JSON file.
Constraints: NFR-10 (keys never in plain files or project memory), NFR-2 (never logged); Windows, macOS and Linux; a machine may have no credential store (headless Linux); two screens (BYOK, projects list) write settings.
Approaches considered:
- A: the screen saves the whole settings object; the backend moves keys to the store. Risk: the projects screen's stale copy overwrites BYOK changes and the reverse.
- B: separate `get_byok_config` / `save_byok_config` commands; settings.json holds only non-secret BYOK fields; `save_app_settings` keeps the saved BYOK; keys in the OS store via the `keyring` crate.
- C: keys never leave the backend (the screen sees only "set / not set"). Larger change to every model call.
Chosen: B. It removes the overwrite race and keeps keys out of files with a small change.
Switch if: E5 moves all model calls into the backend; then do C so keys never reach the web view.
Safety rules: every write to settings.json strips key fields, whatever the caller passes; a key found in an older settings.json is moved to the store and removed from the file; with no store, keys are not kept and the screen says so with the reason.
Library: keyring 4.2.0 (MIT OR Apache-2.0, MSRV 1.88), `keyring::v1` API; default features select Windows Credential Manager, macOS Keychain, Secret Service. Sources: https://docs.rs/keyring/4.2.0/keyring/v1/index.html, https://docs.rs/keyring/4.2.0/keyring/v1/struct.Entry.html, crate source `src/v1.rs` (Windows store selection).
Edge cases tested: restart round trip, no key text in settings.json, clearing a key deletes it, no credential store, another screen saving with stale or key-carrying BYOK, legacy plain-text key migration, save failure shown in the UI, settings that load after the first render, real Windows Credential Manager round trip (opt-in test).
Generalisation check: providers are not listed beyond the existing protocol enum; key fields are one list (`BYOKConfig::SECRET_FIELDS`); the store is an interface, so other stores can be added.
Assumptions to confirm: none (no-store behaviour approved in PRD amendment 1, NFR-10).
