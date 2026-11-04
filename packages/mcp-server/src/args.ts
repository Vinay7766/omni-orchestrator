import { isAbsolutePath, joinPath, normalizePath } from "@omni/core";

const USAGE = "usage: omni-orchestrator-mcp [--project <folder>] [--user-skills <folder>] [--skills <folder>] [--projects-file <file>]";

export type Args = { ok: true; startDir: string; userSkillsDir?: string; skillsDir?: string; projectsFile?: string } | { ok: false; message: string };

/**
 * Command-line arguments. --project <folder> names the project (absolute, or relative to the
 * working directory), so an MCP config does not depend on where the tool starts the server.
 * --user-skills <folder> is the person's own skills folder (absolute; written by the app, SKL-5).
 */
export function parseArgs(argv: string[], cwd: string): Args {
  const refuse = (): Args => ({ ok: false, message: `unexpected arguments: ${argv.join(" ") || "(none)"}. ${USAGE}` });
  let project: string | undefined;
  let userSkills: string | undefined;
  let skills: string | undefined;
  let projectsFile: string | undefined;
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (value === undefined || value.trim() === "") return refuse();
    if (flag === "--project" && project === undefined) project = value;
    else if (flag === "--user-skills" && userSkills === undefined && isAbsolutePath(value)) userSkills = normalizePath(value);
    // The bundled skills, next to the installed server (retest bug 2); absolute, written by the app.
    else if (flag === "--skills" && skills === undefined && isAbsolutePath(value)) skills = normalizePath(value);
    // The projects the person registered in the app (RT-14); absolute, written by the app.
    else if (flag === "--projects-file" && projectsFile === undefined && isAbsolutePath(value)) projectsFile = normalizePath(value);
    else return refuse();
  }
  const base = normalizePath(cwd);
  return {
    ok: true,
    startDir: project === undefined ? base : joinPath(base, project),
    ...(userSkills !== undefined ? { userSkillsDir: userSkills } : {}),
    ...(skills !== undefined ? { skillsDir: skills } : {}),
    ...(projectsFile !== undefined ? { projectsFile } : {}),
  };
}
