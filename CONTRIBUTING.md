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

---

## 🔒 Security Vulnerability Reporting

If you find a security issue or vulnerability, please do NOT file a public issue. Open a private security advisory on GitHub or report directly to the project maintainers.
