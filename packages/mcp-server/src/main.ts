#!/usr/bin/env node
/**
 * Entry point an AI tool starts from its MCP config: `node <this file>` (stdio).
 * stdout carries the protocol, so diagnostics go to stderr only.
 */
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { normalizePath } from "@omni/core";
import { createNodeFs, createSkillDirectorySource } from "@omni/core/node";
import { createServer } from "./server.js";

/** The skill catalog: OMNI_SKILLS_DIR, else the repository's /skills folder (dist/../../../skills). */
const skillsDir = process.env.OMNI_SKILLS_DIR || fileURLToPath(new URL("../../../skills", import.meta.url));

const server = createServer({
  fs: createNodeFs(),
  skills: createSkillDirectorySource(skillsDir),
  startDir: normalizePath(process.cwd()),
});

server.connect(new StdioServerTransport()).catch((error: unknown) => {
  console.error(`omni-orchestrator MCP server could not start: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
