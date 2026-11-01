export { MEMORY_FORMAT_VERSION, MEMORY_DIR } from "./constants.js";

export { validateMemoryFile } from "./validate.js";
export type { SchemaName, ValidationIssue, ValidationResult } from "./validate.js";
export { redactText, redactJson } from "./redact.js";
export type { TextFinding, JsonFinding } from "./redact.js";

export { MemoryStore } from "./memory/store.js";
export type { StoreOptions, StoreResult, EventInput, AppendResult, LineIssue } from "./memory/store.js";
export type { MemoryFs } from "./memory/fs.js";
export { initialState, applyEvent, rebuild } from "./memory/reduce.js";
export { findProject, LINK_FILE } from "./memory/discover.js";
export type { FindProjectResult } from "./memory/discover.js";
export { normalizePath, parentDir, joinPath, isAbsolutePath } from "./memory/paths.js";
export { checkRefs } from "./memory/refs.js";
export type { CommitChecker, GitLookup, RefResult, RefStatus } from "./memory/refs.js";

export { SCHEMA_NAMES, FLOWS, PHASE_IDS } from "./generated/contract.js";
export type * from "./generated/types.js";
