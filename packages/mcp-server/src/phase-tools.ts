/** Phase tools (ARCHITECTURE 5; SKL-2, SKL-3, GATE-3, UND-1). There is deliberately no approve tool. */
import type { ResolvedSkill } from "@omni/core";
import { currentSkills, openProject, type ToolDeps } from "./project.js";

export type ToolResult<T> = { ok: true; value: T } | { ok: false; message: string };

export interface PhaseSkills {
  phase: string;
  skills: (Pick<ResolvedSkill, "id" | "name" | "reason" | "license"> & { content: string })[];
  warnings: string[];
}

/** Full text of the current phase's skills (never the whole catalog); `ids` narrows the set. */
export async function getPhaseSkills(
  deps: ToolDeps,
  input: { projectPath?: string; ids?: string[] },
): Promise<ToolResult<PhaseSkills>> {
  const opened = await openProject(deps, input.projectPath);
  if (!opened.ok) return opened;
  const phase = (await opened.store.readState()).currentPhase;
  if (phase === null) {
    return { ok: false, message: "No phase has started yet. Ask the user to start the first phase in the OmniOrchestrator app." };
  }
  const warnings: string[] = [];
  const resolved = await currentSkills(deps.skills, opened.store, phase, warnings);
  const allowed = resolved.map((s) => s.id);
  const outside = (input.ids ?? []).filter((id) => !allowed.includes(id));
  if (outside.length > 0) {
    return {
      ok: false,
      message: `${outside.join(", ")} ${outside.length === 1 ? "is" : "are"} not a skill of the "${phase}" phase. Its skills are: ${allowed.join(", ") || "none"}.`,
    };
  }
  const wanted = input.ids ? resolved.filter((s) => input.ids!.includes(s.id)) : resolved;
  const skills: PhaseSkills["skills"] = [];
  for (const skill of wanted) {
    const content = await deps.skills.readContent(skill.id);
    if (content === null) {
      warnings.push(`The text of skill "${skill.id}" could not be read; it was left out.`);
      continue;
    }
    skills.push({ id: skill.id, name: skill.name, reason: skill.reason, license: skill.license, content });
  }
  return { ok: true, value: { phase, skills, warnings } };
}
