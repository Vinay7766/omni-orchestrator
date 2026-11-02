# Contributing to OmniOrchestrator

Thank you for your interest in contributing to OmniOrchestrator! We are building a high-discipline, local-first engine bridging AI agent engineering with autonomous IDE execution.

---

## 🛠️ Code & Architectural Principles

1. **Red-Green-Refactor TDD**:
   - Write tests first. All code changes, fixes, and features must be accompanied by passing unit/integration tests.
2. **Anti-Vibe-Coding Guardrails**:
   - Every feature must have a clear specification before implementation.
   - Strictly avoid bloat and keep context overhead minimal (<1500 chars for core rules).
3. **Commit Standards**:
   - We enforce the [Conventional Commits](https://www.conventionalcommits.org/) specification:
     - `feat:` for new capabilities
     - `fix:` for bug fixes
     - `test:` for test additions or refactors
     - `docs:` for documentation updates
     - `chore:` for tooling or dependencies

---

## 🧪 Local Testing Workflow

Before submitting a Pull Request, verify that all local checks pass:

```bash
# Frontend Unit & UI Tests
npm test

# Production Vite Bundle & Type Check
npm run build

# Rust Backend Integration Tests
cargo test --manifest-path src-tauri/Cargo.toml
```

### Check the way CI does, before every push

Passing in your working copy is not enough: leftover build output and caches can hide a failure that CI will see. Enable the pre-push check once per clone:

```bash
git config core.hooksPath scripts/hooks
```

On every push it runs CI's steps for your OS in fresh checkouts, one per CI job, and blocks the push if any step fails. The steps are read from `.github/workflows/ci.yml`, so the check always matches CI. Documentation-only pushes skip it.

Recommended routine: run `npm run ci:check` first, then `git push`. A commit that passed is recorded (in `.git/ci-check-passed/`, per commit and OS), so the push of that same commit is not checked again. This matters because git connects to the remote before the hook runs: a long check during the push can lose that connection (seen as an SSL error), although the check itself passed.

It only covers your own OS: CI still checks the others after the push. `git push --no-verify` bypasses it; use that only in an emergency, and say so in the pull request.

---

## 🔒 Security Vulnerability Reporting

If you find a security issue or vulnerability, please do NOT file a public issue. Open a private security advisory on GitHub or report directly to the project maintainers.
