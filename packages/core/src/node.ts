/** Node-only entry point (@omni/core/node): file system and git access for the MCP server and extension. */
export { createNodeFs } from "./memory/node-fs.js";
export { createGitCommitChecker, interpretGitResult } from "./memory/node-git.js";
export { createSkillDirectorySource } from "./skills/node-source.js";
