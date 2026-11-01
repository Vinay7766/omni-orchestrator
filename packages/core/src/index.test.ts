import { describe, it, expect } from "vitest";
import { MEMORY_DIR, MEMORY_FORMAT_VERSION } from "./index.js";

describe("@omni/core", () => {
  it("exposes the memory folder name and format version", () => {
    expect(MEMORY_DIR).toBe(".agents");
    expect(MEMORY_FORMAT_VERSION).toBeGreaterThanOrEqual(1);
  });
});
