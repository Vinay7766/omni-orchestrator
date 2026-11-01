import type { MemoryFileTypes } from "../generated/types.js";
import type { ValidationIssue } from "../validate.js";

/** One entry of skills/catalog.json. */
export type CatalogEntry = MemoryFileTypes["skill-catalog"][number];
type SkillsConfig = MemoryFileTypes["skills-config"];

/**
 * Where skills come from. Node reads the /skills folder (@omni/core/node); the desktop app
 * supplies one backed by the catalog Rust already embeds.
 */
export interface SkillSource {
  list(): Promise<{ ok: true; entries: CatalogEntry[] } | { ok: false; issues: ValidationIssue[] }>;
  /** The full SKILL.md text, or null if there is no such skill. */
  readContent(id: string): Promise<string | null>;
}

export interface ResolvedSkill {
  id: string;
  name: string;
  description: string;
  license: string;
  attribution: CatalogEntry["attribution"];
  /** "phase": mapped to this phase; "all-phases": mapped to every phase. */
  reason: "phase" | "all-phases";
}

/**
 * The skills an agent should use in `phase` (SKL-2, SKL-3, SKL-5): the phase's own skills
 * first, then skills for every phase, each group in catalog order. Project overrides can
 * disable, re-enable or re-map skills. Descriptions only; load full text with readContent.
 */
export function resolvePhaseSkills(
  catalog: CatalogEntry[],
  overrides: SkillsConfig | null,
  phase: string,
): { skills: ResolvedSkill[]; warnings: string[] } {
  const changes = overrides?.skills ?? {};
  const known = new Set(catalog.map((e) => e.id));
  const warnings = Object.keys(changes)
    .filter((id) => !known.has(id))
    .map((id) => `skills.json overrides "${id}", which is not in the skill catalog`);

  const own: ResolvedSkill[] = [];
  const everywhere: ResolvedSkill[] = [];
  for (const entry of catalog) {
    const change = changes[entry.id];
    if (!(change?.enabled ?? entry.enabled)) continue;
    const phases = change?.phases ?? entry.phases;
    const skill = (reason: ResolvedSkill["reason"]): ResolvedSkill => ({
      id: entry.id,
      name: entry.name,
      description: entry.description,
      license: entry.license,
      attribution: entry.attribution,
      reason,
    });
    if (phases.includes(phase)) own.push(skill("phase"));
    else if (phases.includes("all")) everywhere.push(skill("all-phases"));
  }
  if (own.length === 0) warnings.push(`no skill is mapped to phase "${phase}"; only skills for every phase are offered`);
  return { skills: [...own, ...everywhere], warnings };
}
