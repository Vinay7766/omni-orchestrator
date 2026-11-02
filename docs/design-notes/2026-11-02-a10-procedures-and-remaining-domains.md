## A10: stack selection, red team / blue team, threat model, remaining domains (2026-11-02)

Scope: STK-1..3 (stack-selection), SEC-2/SEC-3 (red-team, blue-team), SEC-6 (written threat model), and, added by the owner on 2026-11-02, the seven Amendment 2 domains no other task covered.

### Slice 1: the seven Amendment 2 domains
Searched official vendors first (Stripe), the vetted collections (wshobson, Anthropic, Google, AWS), then GitHub code search by skill name. Most hits for networking, algorithms, design patterns, legacy modernization and configuration management came from unknown single-author collections, which the A5 vetting bar does not accept.
- payments: bundled `stripe-best-practices` (Stripe, MIT), read in full, self-contained rules and routing; references not bundled. Rejected wshobson `pci-compliance`: its examples use Stripe's legacy Charges/Tokens APIs and a hard-coded global key, contradicting Stripe's own skill.
- Covered by skills already shipped, after reading their content (tags added, not new text): software maintenance (`deprecation-and-migration`, `code-simplification`), configuration management (`git-workflow-and-versioning`: versions, tags, release changelogs), low-level design (`architecture-patterns`: clean / hexagonal / DDD module structure; `api-and-interface-design`: module boundaries and type contracts), algorithms and data structures (`solution-design`: problem class and derived complexity, partial).
- Still gaps, with reasons as domain notes: networking (no reputable skill found), i18n/l10n (FormatJS's skill has no license file; swiftui-expert-skill covers Apple only).
- Partial coverage recorded as notes: algorithms (no skill teaches specific algorithms), configuration management (environment configuration), payments (provider-neutral PCI DSS).
