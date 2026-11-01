import * as generated from "./generated/validators.js";
import { SCHEMA_NAMES, VALIDATOR_EXPORTS, PHASE_IDS } from "./generated/contract.js";
import type { MemoryFileTypes } from "./generated/types.js";

/** Name of a project-memory file schema, taken from the files in /schemas. */
export type SchemaName = (typeof SCHEMA_NAMES)[number];

/** One problem found in a memory file. `path` is a JSON Pointer ("" is the whole document). */
export interface ValidationIssue {
  path: string;
  message: string;
}

/** Validation never throws: it returns the typed value or the list of issues. */
export type ValidationResult<T> = { ok: true; value: T } | { ok: false; issues: ValidationIssue[] };

interface AjvError {
  instancePath: string;
  keyword: string;
  message?: string;
  params: Record<string, unknown>;
}
type GeneratedValidator = ((data: unknown) => boolean) & { errors?: AjvError[] | null };

const knownPhases: ReadonlySet<string> = new Set(PHASE_IDS);

/**
 * Validates data against a project-memory schema, then applies the rules a schema
 * cannot express (phase ids must exist in schemas/phases.json; a design note's
 * `chosen` must name one of its approaches).
 */
export function validateMemoryFile<N extends SchemaName>(
  name: N,
  data: unknown,
): ValidationResult<MemoryFileTypes[N]> {
  const validator = (generated as unknown as Record<string, GeneratedValidator>)[VALIDATOR_EXPORTS[name]];
  if (!validator(data)) {
    return { ok: false, issues: (validator.errors ?? []).map(toIssue) };
  }
  const issues = semanticIssues(name, data as Record<string, unknown>);
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: data as MemoryFileTypes[N] };
}

function toIssue(error: AjvError): ValidationIssue {
  const detail =
    error.keyword === "additionalProperties"
      ? `unexpected property "${String(error.params.additionalProperty)}"`
      : error.keyword === "enum"
        ? `${error.message ?? "invalid value"}: ${JSON.stringify(error.params.allowedValues)}`
        : (error.message ?? error.keyword);
  return { path: error.instancePath, message: detail };
}

function unknownPhase(path: string, phase: unknown): ValidationIssue[] {
  return typeof phase === "string" && !knownPhases.has(phase)
    ? [{ path, message: `unknown phase "${phase}" (not in schemas/phases.json)` }]
    : [];
}

function semanticIssues(name: SchemaName, data: Record<string, unknown>): ValidationIssue[] {
  switch (name) {
    case "state": {
      const phases = Object.keys((data.phases as Record<string, unknown>) ?? {});
      return [
        ...unknownPhase("/currentPhase", data.currentPhase),
        ...phases.flatMap((phase) => unknownPhase(`/phases/${phase}`, phase)),
      ];
    }
    case "event": {
      const payload = (data.payload as Record<string, unknown>) ?? {};
      return unknownPhase("/payload/phase", payload.phase);
    }
    case "skills-config": {
      const skills = (data.skills as Record<string, { phases?: string[] }>) ?? {};
      return Object.entries(skills).flatMap(([id, override]) =>
        (override.phases ?? []).flatMap((phase, i) =>
          phase === "all" ? [] : unknownPhase(`/skills/${id}/phases/${i}`, phase),
        ),
      );
    }
    case "design-note": {
      const names = ((data.approaches as { name: string }[]) ?? []).map((a) => a.name);
      return names.includes(data.chosen as string)
        ? []
        : [{ path: "/chosen", message: `"${String(data.chosen)}" is not one of the approaches: ${JSON.stringify(names)}` }];
    }
    default:
      return [];
  }
}
