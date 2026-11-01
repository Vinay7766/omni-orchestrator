import { joinPath, normalizePath } from "@omni/core";

const USAGE = "usage: omni-orchestrator-mcp [--project <folder>]";

/**
 * Command-line arguments. --project <folder> names the project (absolute, or relative to the
 * working directory), so an MCP config does not depend on where the tool starts the server.
 */
export function parseArgs(argv: string[], cwd: string): { ok: true; startDir: string } | { ok: false; message: string } {
  if (argv.length === 0) return { ok: true, startDir: normalizePath(cwd) };
  if (argv.length === 2 && argv[0] === "--project" && argv[1].trim() !== "") {
    return { ok: true, startDir: joinPath(normalizePath(cwd), argv[1]) };
  }
  return { ok: false, message: `unexpected arguments: ${argv.join(" ") || "(none)"}. ${USAGE}` };
}
