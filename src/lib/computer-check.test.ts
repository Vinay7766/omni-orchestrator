import { describe, it, expect } from "vitest";
import { checkComputer } from "./computer-check";

// G: the app looks at the computer instead of asking "are you technical?".

const tool = { id: "made-up-editor", name: "Made-up Editor", category: "editor" as const, capability: 3, evidence: [], needsConfirmation: false };

describe("checkComputer", () => {
  it("finds nothing missing when Git and an AI coding tool are there", async () => {
    const check = await checkComputer({ gitVersion: async () => "git version 2.47.0", tools: async () => ({ ok: true, tools: [tool] }) });
    expect(check.missing).toEqual([]);
  });

  it("names what is missing: Git, and an AI coding tool or editor", async () => {
    const check = await checkComputer({ gitVersion: async () => null, tools: async () => ({ ok: true, tools: [] }) });
    expect(check.missing).toEqual(["Git", "an AI coding tool or editor"]);
  });

  it("never claims a tool is missing when the check itself failed", async () => {
    const check = await checkComputer({ gitVersion: () => Promise.reject("no shell"), tools: async () => ({ ok: false, error: "discovery failed" }) });
    expect(check.missing).toEqual([]);
    expect(check.unchecked).toEqual(["Git", "AI coding tools"]);
  });
});
