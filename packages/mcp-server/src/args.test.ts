import { describe, it, expect } from "vitest";
import { parseArgs } from "./args.js";

describe("server arguments", () => {
  it("uses the working directory when no project is given", () => {
    expect(parseArgs([], "/work/here")).toEqual({ ok: true, startDir: "/work/here" });
  });

  it("uses --project, resolving a relative folder against the working directory", () => {
    expect(parseArgs(["--project", "/repos/orbit"], "/home/me")).toEqual({ ok: true, startDir: "/repos/orbit" });
    expect(parseArgs(["--project", "../orbit"], "/repos/other")).toEqual({ ok: true, startDir: "/repos/orbit" });
    expect(parseArgs(["--project", "C:\\repos\\orbit"], "D:/x")).toEqual({ ok: true, startDir: "C:/repos/orbit" });
  });

  it("takes the person's own skills folder with --user-skills, in any order (SKL-5)", () => {
    expect(parseArgs(["--user-skills", "/data/omni/skills"], "/w")).toEqual({ ok: true, startDir: "/w", userSkillsDir: "/data/omni/skills" });
    expect(parseArgs(["--user-skills", "/data/s", "--project", "/repos/orbit"], "/w")).toEqual({ ok: true, startDir: "/repos/orbit", userSkillsDir: "/data/s" });
    expect(parseArgs(["--project", "/repos/orbit", "--user-skills", "C:\\Data\\skills"], "/w")).toEqual({ ok: true, startDir: "/repos/orbit", userSkillsDir: "C:/Data/skills" });
  });

  it("takes the bundled skills folder with --skills, so the installed app needs no repository (retest bug 2)", () => {
    expect(parseArgs(["--skills", "/data/omni/mcp-server/skills", "--project", "/repos/orbit"], "/w")).toEqual({ ok: true, startDir: "/repos/orbit", skillsDir: "/data/omni/mcp-server/skills" });
    expect(parseArgs(["--skills", "relative"], "/w").ok).toBe(false);
  });

  it("refuses anything it does not understand, with usage", () => {
    for (const argv of [["--project"], ["--project", ""], ["--verbose"], ["extra"], ["--user-skills"], ["--user-skills", "relative/skills"], ["--project", "/a", "--project", "/b"]]) {
      const result = parseArgs(argv, "/w");
      expect(result.ok, argv.join(" ")).toBe(false);
      if (!result.ok) expect(result.message).toMatch(/usage: .*--project <folder>.*--user-skills <folder>.*--skills <folder>/i);
    }
  });
});
