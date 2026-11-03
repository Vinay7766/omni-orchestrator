#!/usr/bin/env node
/**
 * Entry point an AI tool starts from its MCP config: `node <this file>` (stdio).
 * stdout carries the protocol, so diagnostics go to stderr only.
 */
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createGitCommitChecker, createNodeFs, createSkillDirectorySource } from "@omni/core/node";
import { parseArgs } from "./args.js";
import { closeServer, createServer } from "./server.js";

/** The skill catalog: OMNI_SKILLS_DIR, else the repository's /skills folder (dist/../../../skills). */
const skillsDir = process.env.OMNI_SKILLS_DIR || fileURLToPath(new URL("../../../skills", import.meta.url));

const args = parseArgs(process.argv.slice(2), process.cwd());
if (!args.ok) {
  console.error(`omni-orchestrator MCP server: ${args.message}`);
  process.exit(2);
}

const server = createServer({
  fs: createNodeFs(),
  skills: createSkillDirectorySource(skillsDir),
  startDir: args.startDir,
  commits: createGitCommitChecker(),
});

server.connect(new StdioServerTransport()).catch((error: unknown) => {
  console.error(`omni-orchestrator MCP server could not start: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

// The tool closing our stdin or stopping the process ends its session (HND-8): close the
// connection, let the session's end be recorded, then exit.
let closing = false;
const shutdown = () => {
  if (closing) return;
  closing = true;
  void closeServer(server).finally(() => process.exit(0));
};
process.stdin.on("end", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
