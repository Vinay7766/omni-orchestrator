## E4: restructure the dashboard around projects and phases (2026-11-02)

Problem: the app opens on a Track A / Track B chat with a track picker; APP-1..3 and ARCHITECTURE 8.2 want a dashboard whose home is the projects list, with pitch mode, BYOK settings and the skill catalog as their own areas, and every working feature still reachable.
Inputs/outputs: no new data. Existing Tauri commands only (`get_app_settings`, `find_projects`, `get_byok_config`, `save_byok_config`, `discover_tools`, `get_skills`, `generate_project_brief`, `launch_and_build`, `execute_strategic_teardown`).
Constraints: no fake data (the header "Ledger: .agents/session-state.json" pill names a file the memory layer never writes, so it goes); dark theme, Lucide icons only; keyboard reachable navigation with the current area announced (`aria-current="page"`); components under ~200 lines (App.tsx is 444 today).
Existing features and where each lands:
- Projects list, project detail, phase history, memory, decisions (E2/E3) -> **Projects** area, the default.
- Track A (idea -> brief -> stage -> launch IDE) -> **Start from an idea** area, same chat and staging modal. E5 replaces it with the planning workspace.
- Track B teardown -> **Pitch mode** area (APP-3, APP-4), same chat and teardown viewer.
- BYOK settings -> **Settings** area (used by pitch mode now and by planning in E5, so not owned by pitch mode); pitch mode shows the same panel above its input, so the provider in use is visible and editable there too.
- Skill catalog (modal opened from the header) -> **Skills** area, same cards, search, view/edit modal.
- Tool detection result ("Target tool") -> shown in Start from an idea, where the launcher uses it.
- Stack ADR (C16) recorded on architecture submissions -> shown in the phase history.
Approaches considered:
- A: left sidebar of areas, one area rendered at a time; the chat for Track A and pitch mode stays as it is, with the track fixed by the area (picker removed). Small change, every feature keeps its tested component.
- B: tabs inside the projects page, with pitch and skills as dialogs. Hides pitch mode and BYOK behind a project although neither belongs to one; rejected.
- C: router library with URLs per area. A desktop app with five areas does not need URLs; adds a dependency for no requirement; rejected.
Chosen: A, because it meets APP-1..3 with the least change and keeps each existing component and its tests.
Switch if: areas need deep links (tutorials pointing at a specific project phase, v0.5) -> add routing then.
Rules: chat history is kept per area (switching areas does not lose a pitch teardown or a brief); an area's panels keep their error boundaries; the BYOK load error is shown in Settings.
Edge cases tested: app opens on Projects; every area reachable from the nav and marked current; no track picker anywhere; no "Ledger" text; idea brief failure and teardown failure still show the backend error; BYOK load and save through the credential-store command from Settings; pitch mode shows the provider saved in Settings; skill search filters; a submission with a stack ADR shows it, one without does not.
Generalisation check: no named examples (provider names come from the existing BYOK component).
Not covered: tutorials and simple mode (v0.5); tool selection per project (TOOL-*, later tasks).
Assumptions to confirm: the sidebar labels ("Projects", "Start from an idea", "Pitch mode", "Skills", "Settings").
