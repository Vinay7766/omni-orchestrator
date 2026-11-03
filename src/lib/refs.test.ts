import { describe, it, expect } from "vitest";
import { folderOfRef, showRefInFolder } from "./refs";

describe("folderOfRef (P-E8-02)", () => {
  it("opens the folder that holds a project file", () => {
    expect(folderOfRef("C:/work/orbit", "docs/planning/prd.md")).toBe("C:/work/orbit/docs/planning");
    expect(folderOfRef("/home/me/orbit", "README.md")).toBe("/home/me/orbit");
  });

  it("refuses paths that leave the project", () => {
    for (const bad of ["../outside/x.md", "docs/../../x", "/etc/passwd", "C:/Windows/x", ""]) {
      expect(() => folderOfRef("/home/me/orbit", bad), bad).toThrow(/not a path inside the project/);
    }
  });

  it("asks the app's open_folder command for the folder, never for the file", async () => {
    const calls: unknown[] = [];
    await showRefInFolder(async (cmd, args) => void calls.push([cmd, args]), "/home/me/orbit", "src/app.ts");
    expect(calls).toEqual([["open_folder", { path: "/home/me/orbit/src" }]]);
  });
});
