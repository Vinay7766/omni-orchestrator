import { MEMORY_FORMAT_VERSION } from "@omni/core";

/** Server identity reported to MCP clients. */
export const SERVER_INFO = {
  name: "omni-orchestrator",
  version: "0.1.0",
  memoryFormat: MEMORY_FORMAT_VERSION,
} as const;
