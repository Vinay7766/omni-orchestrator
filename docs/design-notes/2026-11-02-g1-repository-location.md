## G1 fix: is the project the repository root? (2026-11-02)

Problem: `checkRefs` warned "commits were checked against a repository in a parent folder" when the project *was* the repository root but was reached by another spelling of the same folder.
Constraints: one git call per check (5 s timeout); works for any spelling: macOS `/var` -> `/private/var` link, Windows 8.3 short names, junctions, drive-letter case; the core library has no realpath in its file-system adapter.
Approaches considered:
- A: resolve both paths with realpath and compare (needs a new adapter method in Node and Tauri; still string comparison after resolving)
- B: ask git: `rev-parse --show-toplevel --show-prefix`; an empty prefix means the project is the root (same single call; no path comparison)
Chosen: B, because git already knows where the working folder sits and no spelling can fool it.
Switch if: a commit checker that is not git needs the same answer (then add realpath to the adapter).
Edge cases tested: project through a directory link (junction on Windows), a sub-folder of a repository, no repository, a fake checker with a differently spelled root and empty prefix.
Generalisation check: no named examples; any link or alias is covered because no path text is compared.
Assumptions to confirm: none.
Found by: the macOS and Windows CI jobs added in G1 (run 41389381960). Commit f6f5bec.
