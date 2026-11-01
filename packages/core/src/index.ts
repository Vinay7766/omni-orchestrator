export { MEMORY_FORMAT_VERSION, MEMORY_DIR } from "./constants.js";

export { validateMemoryFile } from "./validate.js";
export type { SchemaName, ValidationIssue, ValidationResult } from "./validate.js";
export { redactText, redactJson } from "./redact.js";
export type { TextFinding, JsonFinding } from "./redact.js";

export { MemoryStore } from "./memory/store.js";
export type { StoreOptions, StoreResult, EventInput, AppendResult, LineIssue } from "./memory/store.js";
export type { MemoryFs } from "./memory/fs.js";
export { initialState, applyEvent, rebuild } from "./memory/reduce.js";
export { renderSummary, renderDecisions, renderProblems, renderLessons, refreshMemoryDocs } from "./memory/docs.js";
export { findProject, LINK_FILE } from "./memory/discover.js";
export type { FindProjectResult } from "./memory/discover.js";
export { normalizePath, parentDir, joinPath, isAbsolutePath } from "./memory/paths.js";
export { checkRefs } from "./memory/refs.js";
export type { CommitChecker, GitLookup, RefResult, RefStatus, RepositoryInfo } from "./memory/refs.js";

export { PhaseEngine, checkPhaseAction, nextPhase, REVIEW_QUESTION } from "./engine/phases.js";
export type { PhaseAction, PhaseContext, PhaseResult, CheckResult } from "./engine/phases.js";
export type { EventGuard } from "./memory/store.js";
export { resolvePhaseSkills } from "./skills/resolve.js";
export type { CatalogEntry, SkillSource, ResolvedSkill } from "./skills/resolve.js";
export { TaskEngine, checkTaskAction, designNotePath } from "./engine/tasks.js";
export type { TaskAction, TaskResult } from "./engine/tasks.js";

export { SCHEMA_NAMES, FLOWS, PHASE_IDS, PLANNING_PHASES } from "./generated/contract.js";
export type * from "./generated/types.js";
