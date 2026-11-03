/**
 * The tools the person selected for a project (TOOL-2, TEAM-1), kept in .agents/team.json.
 * Only the person selects: a selection sent as an agent is refused. Each save is also recorded
 * as the person's decision, so the history shows who chose which tools and when.
 */
import type { Event, Team } from "../generated/types.js";
import { MEMORY_DIR } from "../constants.js";
import { validateMemoryFile } from "../validate.js";
import { recordDecision, type RecordTarget } from "../memory/record.js";

export type { Team };
export type TeamMember = Team["members"][number];
/** One selected tool, as the person picked it; when it was first added is kept by saveTeam. */
export type TeamSelection = Omit<TeamMember, "addedAt">;

export const TEAM_FILE = "team.json";

export type ReadTeamResult = { ok: true; team: Team | null } | { ok: false; message: string };
export type SaveTeamResult = { ok: true; team: Team; warnings: string[] } | { ok: false; message: string };

/** The saved team, null when the person has not selected tools yet, or why the file is unusable. */
export async function readTeam(store: { readFile(name: string): Promise<string | null> }): Promise<ReadTeamResult> {
  const text = await store.readFile(TEAM_FILE);
  if (text === null) return { ok: true, team: null };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, message: `${MEMORY_DIR}/${TEAM_FILE} is not valid JSON. Select the tools again to replace it.` };
  }
  const valid = validateMemoryFile("team", data);
  if (!valid.ok) {
    const issues = valid.issues.map((i) => `${i.path} ${i.message}`.trim()).join("; ");
    return { ok: false, message: `${MEMORY_DIR}/${TEAM_FILE} is not a valid team file (${issues}). Select the tools again to replace it.` };
  }
  return { ok: true, team: valid.value };
}

function memberLabel(member: TeamSelection): string {
  const models = member.models && member.models.length > 0 ? `, models: ${member.models.join(", ")}` : "";
  return `${member.name} (level ${member.capability}${member.confirmedByPerson ? ", confirmed by the person" : ""}${models})`;
}

/** Saves the person's selection to team.json and records it as their decision. */
export async function saveTeam(
  target: RecordTarget,
  actor: Event["actor"],
  selection: readonly TeamSelection[],
  now: string = new Date().toISOString(),
): Promise<SaveTeamResult> {
  if (actor.kind !== "human") {
    return { ok: false, message: "Only the person selects the tools for a project; an agent cannot change the team." };
  }
  const previous = await readTeam(target.store);
  const firstAdded = new Map((previous.ok && previous.team ? previous.team.members : []).map((m) => [m.toolId, m.addedAt]));
  const team: Team = {
    formatVersion: 1,
    updatedAt: now,
    members: selection.map((m) => ({ ...m, addedAt: firstAdded.get(m.toolId) ?? now })),
  };
  const valid = validateMemoryFile("team", team);
  if (!valid.ok) {
    return { ok: false, message: `The selection was not saved: ${valid.issues.map((i) => `${i.path} ${i.message}`.trim()).join("; ")}.` };
  }
  await target.store.writeFile(TEAM_FILE, `${JSON.stringify(team, null, 2)}\n`);
  const recorded = await recordDecision(target, actor, {
    title: "Tools for this project",
    decision: selection.length > 0 ? `Team: ${selection.map(memberLabel).join(", ")}.` : "No tools selected.",
    reason: "Selected by the person from the tools found on this computer.",
    refs: { files: [`${MEMORY_DIR}/${TEAM_FILE}`] },
  });
  if (!recorded.ok) return { ok: false, message: `The team was saved, but the decision could not be recorded: ${recorded.message}` };
  return { ok: true, team, warnings: recorded.warnings };
}
