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

  it("refuses anything it does not understand, with usage", () => {
    for (const argv of [["--project"], ["--project", ""], ["--verbose"], ["extra"]]) {
      const result = parseArgs(argv, "/w");
      expect(result.ok, argv.join(" ")).toBe(false);
      if (!result.ok) expect(result.message).toMatch(/usage: .*--project <folder>/i);
    }
  });
});
