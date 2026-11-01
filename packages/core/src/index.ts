/** Version of the project memory format this library reads and writes. */
export const MEMORY_FORMAT_VERSION = 1;

/** Name of the per-project memory folder. */
export const MEMORY_DIR = ".agents";

export { validateMemoryFile } from "./validate.js";
export type { SchemaName, ValidationIssue, ValidationResult } from "./validate.js";
export { SCHEMA_NAMES, FLOWS, PHASE_IDS } from "./generated/contract.js";
export type * from "./generated/types.js";
