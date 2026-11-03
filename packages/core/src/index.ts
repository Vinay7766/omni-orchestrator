export { MEMORY_FORMAT_VERSION, MEMORY_DIR } from "./constants.js";

export { validateMemoryFile } from "./validate.js";
export type { SchemaName, ValidationIssue, ValidationResult } from "./validate.js";
export { redactText, redactJson } from "./redact.js";
export type { TextFinding, JsonFinding } from "./redact.js";

export { MemoryStore } from "./memory/store.js";
export type { StoreOptions, StoreResult, EventInput, AppendResult, LineIssue } from "./memory/store.js";
export type { MemoryFs } from "./memory/fs.js";
export { createInvokeFs, MEMORY_FS_COMMANDS } from "./memory/invoke-fs.js";
export type { Invoke } from "./memory/invoke-fs.js";
export { initialState, applyEvent, rebuild } from "./memory/reduce.js";
export { EventFollower, watchEvents } from "./memory/sync.js";
export { parseAdapters, adapterFor, applyManagedBlock, mcpSetupSnippet, MANAGED_BEGIN, MANAGED_END } from "./adapters/adapters.js";
export type { Adapter, AdapterIssue, ManagedBlockStatus, McpServerCommand, McpSnippet } from "./adapters/adapters.js";
export type { SyncUpdate, ChangeTrigger, WatchOptions, EventWatch } from "./memory/sync.js";
export { renderSummary, renderDecisions, renderProblems, renderLessons, refreshMemoryDocs } from "./memory/docs.js";
export { findProject, LINK_FILE } from "./memory/discover.js";
export { projectOverview } from "./memory/overview.js";
export type { ProjectOverview } from "./memory/overview.js";
export { phaseHistory, buildPhaseHistory } from "./memory/history.js";
export type { PhaseHistoryEntry } from "./memory/history.js";
export { recordDecision, recordProblem, recordLesson, verifyReferences } from "./memory/record.js";
export type { RecordTarget, RecordResult, ReferenceCheck, Refs } from "./memory/record.js";
export type { FindProjectResult } from "./memory/discover.js";
export { normalizePath, parentDir, joinPath, isAbsolutePath } from "./memory/paths.js";
export { checkRefs } from "./memory/refs.js";
export type { CommitChecker, GitLookup, RefResult, RefStatus, RepositoryInfo, RepositoryLocation } from "./memory/refs.js";

export { PhaseEngine, checkPhaseAction, nextPhase, REVIEW_QUESTION } from "./engine/phases.js";
export type { PhaseAction, PhaseContext, PhaseResult, CheckResult } from "./engine/phases.js";
export { checkStackAdr, STACK_ADR_SECTIONS } from "./engine/stack-adr.js";
export { continueAfterDecision } from "./engine/continue.js";
export type { ContinueResult } from "./engine/continue.js";
export type { EventGuard } from "./memory/store.js";
export { resolvePhaseSkills } from "./skills/resolve.js";
export type { CatalogEntry, SkillSource, ResolvedSkill } from "./skills/resolve.js";
export { TaskEngine, checkTaskAction, designNotePath } from "./engine/tasks.js";
export type { TaskAction, TaskResult } from "./engine/tasks.js";
export { readTeam, saveTeam, TEAM_FILE } from "./team/team.js";
export type { Team, TeamMember, TeamSelection, ReadTeamResult, SaveTeamResult } from "./team/team.js";

export { SCHEMA_NAMES, FLOWS, PHASE_IDS, PLANNING_PHASES, STACK_ADR_PHASES, OPTIONAL_PHASES } from "./generated/contract.js";
export type * from "./generated/types.js";
