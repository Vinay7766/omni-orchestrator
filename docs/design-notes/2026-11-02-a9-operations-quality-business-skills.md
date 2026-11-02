## A9: operations, quality and business skills (2026-11-02)

Problem: eight coverage gaps in operations, quality and business work (incident response, end-to-end and load testing, accessibility, compliance and privacy, UX research, product analytics, sales enablement, cost and economics). Fill from reputable sources or say why not.
Constraints: as A8 (only SKILL.md ships; redistributable license with its text; read in full and scanned; uncovered domains must match `pendingGaps`).
Searched: official vendor sources first. Anthropic's knowledge-work-plugins (Apache-2.0, already a vetted source here) has single-file skills for most business functions; Grafana's official skills (Apache-2.0) for k6; Microsoft's playwright-cli (Apache-2.0); AWS's agent toolkit for cost.
Chosen:
- incident-response (Anthropic engineering): severity, roles, status updates, blameless postmortem.
- accessibility-review (Anthropic design). Its "2.5.5 Touch target >= 44x44" is Level AAA in WCAG 2.1, not AA; WCAG 2.2's 2.5.8 is the AA rule at 24 by 24 CSS pixels (both checked on w3.org); correction written in the skill's source section, text left unmodified.
- user-research and research-synthesis (Anthropic design): planning and synthesis.
- metrics-review (Anthropic product management).
- compliance-check (Anthropic legal): states it is not legal advice; its deadlines are rounded and it misses India's DPDP Act 2023, both noted.
- create-an-asset (Anthropic sales): sourced claims only, UNVERIFIED labels, no invented metrics; written for Cowork surfaces, noted.
- vendor-review (Anthropic operations) and aws-billing-and-cost-management (AWS) for cost.
- k6 (Grafana): load, stress and functional tests, validates scripts before use; added a note to load-test only systems the person owns or may test.
Rejected: capacity-plan (team capacity, not systems), testing-strategy (too generic), call-prep (needs CRM and calendar connectors), playwright-cli (end-to-end substance in unbundled reference files; overlaps browser-testing-with-devtools).
Partial coverage recorded as domain notes: system capacity planning, Playwright, India's DPDP Act and licence compliance, build-versus-buy for in-house work and other clouds.
Not checked: GDPR's exact deadline wording (EUR-Lex returned empty pages), so the note says the skill's deadlines are rounded instead of quoting the regulation.
Left for the owner: seven Amendment 2 domains (low-level design, algorithms and data structures, networking, i18n/l10n, software maintenance, configuration management, payments) are in no task's list; A10 covers stack-selection and adversarial-security.
