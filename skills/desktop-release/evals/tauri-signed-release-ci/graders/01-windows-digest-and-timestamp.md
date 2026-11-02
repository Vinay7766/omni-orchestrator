---
type: llm
focus: trace
weight: 1
---

release-plan.md signs Windows installers with a SHA-256 digest and a timestamp server (for example Tauri's digestAlgorithm and timestampUrl, or signtool /fd SHA256 with /tr and /td)
