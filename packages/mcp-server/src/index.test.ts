import { describe, it, expect } from "vitest";
import { MEMORY_FORMAT_VERSION } from "@omni/core";
import { SERVER_INFO } from "./index.js";

describe("@omni/mcp-server", () => {
  it("reports the memory format it was built against", () => {
    expect(SERVER_INFO.name).toBe("omni-orchestrator");
    expect(SERVER_INFO.memoryFormat).toBe(MEMORY_FORMAT_VERSION);
  });
});
