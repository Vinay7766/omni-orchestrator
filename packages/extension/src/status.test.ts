import { describe, it, expect } from "vitest";
import { idleStatusText } from "./status.js";

describe("@omni/extension status", () => {
  it("names the memory folder when no project is open", () => {
    expect(idleStatusText()).toBe("Omni: no .agents project");
  });
});
