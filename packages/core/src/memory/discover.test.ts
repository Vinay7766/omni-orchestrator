import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findProject } from "./discover.js";
import { joinPath, parentDir, isAbsolutePath, normalizePath } from "./paths.js";
import { MemoryStore } from "./store.js";
import { createNodeFs } from "./node-fs.js";

const fs = createNodeFs();
const human = { kind: "human" as const, tool: "omni-desktop" };

describe("path helpers", () => {
  it.each([
    ["C:\\Users\\dev\\app", "C:/Users/dev/app"],
    ["C:/Users//dev/./app/", "C:/Users/dev/app"],
    ["/home/dev/app/", "/home/dev/app"],
    ["\\\\server\\share\\app", "//server/share/app"],
    ["/home/dev/app/../other", "/home/dev/other"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizePath(input)).toBe(expected);
  });

  it.each([
    ["C:/Users/dev/app", "C:/Users/dev"],
    ["C:/Users", "C:/"],
    ["C:/", null],
    ["/home/dev", "/home"],
    ["/home", "/"],
    ["/", null],
    ["//server/share/app", "//server/share"],
    ["//server/share", null],
  ])("parent of %s is %s", (input, expected) => {
    expect(parentDir(input)).toBe(expected);
  });

  it("joins relative paths, resolving .. and keeping absolute ones", () => {
    expect(joinPath("C:/work/feature", "../main")).toBe("C:/work/main");
    expect(joinPath("/work/feature", "../../main")).toBe("/main");
    expect(joinPath("/work/feature", "/elsewhere/app")).toBe("/elsewhere/app");
    expect(joinPath("C:/work", "D:\\other")).toBe("D:/other");
  });

  it("recognizes absolute paths on every platform", () => {
    for (const p of ["/x", "C:/x", "c:\\x", "//server/share"]) expect(isAbsolutePath(p), p).toBe(true);
    for (const p of ["x", "./x", "../x"]) expect(isAbsolutePath(p), p).toBe(false);
  });
});

describe("findProject", () => {
  let base: string;
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "omni-discover-"));
  });
  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  const makeProject = async (dir: string) => {
    mkdirSync(dir, { recursive: true });
    const created = await MemoryStore.create(fs, dir, { name: "p", flow: "build", mode: "full", actor: human });
    if (!created.ok) throw new Error(JSON.stringify(created.issues));
  };
  const writeLink = (dir: string, projectRoot: string) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".agents-link"), JSON.stringify({ formatVersion: 1, projectRoot }));
  };

  it("finds the project from its own root", async () => {
    await makeProject(join(base, "app"));
    const found = await findProject(fs, join(base, "app"));
    expect(found.ok && found.root).toBe(normalizePath(join(base, "app")));
  });

  it("finds the project from a deeply nested folder", async () => {
    await makeProject(join(base, "app"));
    const deep = join(base, "app", "src", "components", "ui", "buttons");
    mkdirSync(deep, { recursive: true });
    const found = await findProject(fs, deep);
    expect(found.ok && found.root).toBe(normalizePath(join(base, "app")));
  });

  it("picks the nearest project when one is nested inside another", async () => {
    await makeProject(join(base, "outer"));
    await makeProject(join(base, "outer", "packages", "inner"));
    const found = await findProject(fs, join(base, "outer", "packages", "inner", "src"));
    expect(found.ok && found.root).toBe(normalizePath(join(base, "outer", "packages", "inner")));
  });

  it("ignores another tool's .agents folder (no project.json) and keeps walking up", async () => {
    await makeProject(join(base, "app"));
    mkdirSync(join(base, "app", "sub", ".agents", "skills"), { recursive: true });
    const found = await findProject(fs, join(base, "app", "sub"));
    expect(found.ok && found.root).toBe(normalizePath(join(base, "app")));
  });

  it("stops at a broken project.json instead of silently using an outer project", async () => {
    await makeProject(join(base, "outer"));
    mkdirSync(join(base, "outer", "inner", ".agents"), { recursive: true });
    writeFileSync(join(base, "outer", "inner", ".agents", "project.json"), '{"formatVersion": 1}');
    const found = await findProject(fs, join(base, "outer", "inner"));
    expect(found.ok).toBe(false);
    expect(!found.ok && found.issues[0].message).toMatch(/invalid/);
  });

  it("reports when no project exists instead of throwing", async () => {
    const found = await findProject(fs, base);
    expect(found.ok).toBe(false);
    expect(!found.ok && found.issues[0].message).toMatch(/no OmniOrchestrator project/);
  });

  it("follows a relative worktree link to the main project", async () => {
    await makeProject(join(base, "main"));
    writeLink(join(base, "main-feature"), "../main");
    mkdirSync(join(base, "main-feature", "src"), { recursive: true });
    const found = await findProject(fs, join(base, "main-feature", "src"));
    expect(found.ok && found.root).toBe(normalizePath(join(base, "main")));
    expect(found.ok && found.linkedFrom).toBe(normalizePath(join(base, "main-feature")));
  });

  it("follows an absolute link", async () => {
    await makeProject(join(base, "main"));
    writeLink(join(base, "elsewhere", "wt"), join(base, "main"));
    const found = await findProject(fs, join(base, "elsewhere", "wt"));
    expect(found.ok && found.root).toBe(normalizePath(join(base, "main")));
  });

  it("refuses a link that points at a folder without a project", async () => {
    mkdirSync(join(base, "empty"), { recursive: true });
    writeLink(join(base, "wt"), "../empty");
    const found = await findProject(fs, join(base, "wt"));
    expect(found.ok).toBe(false);
    expect(!found.ok && found.issues[0].message).toMatch(/no project/);
  });

  it("refuses to follow a chain of links", async () => {
    await makeProject(join(base, "main"));
    writeLink(join(base, "hop"), "../main");
    writeLink(join(base, "wt"), "../hop");
    const found = await findProject(fs, join(base, "wt"));
    expect(found.ok).toBe(false);
    expect(!found.ok && found.issues[0].message).toMatch(/chain/);
  });

  it("refuses a malformed link file", async () => {
    mkdirSync(join(base, "wt"), { recursive: true });
    writeFileSync(join(base, "wt", ".agents-link"), "../main");
    const found = await findProject(fs, join(base, "wt"));
    expect(found.ok).toBe(false);
  });
});
