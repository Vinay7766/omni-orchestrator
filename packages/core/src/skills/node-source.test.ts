import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CatalogEntry } from "./resolve.js";
import { createSkillDirectorySource } from "./node-source.js";

// The person's own skills folder over the bundled catalog (SKL-5, tester feedback 4 and 8).

const entry = (id: string, extra: Partial<CatalogEntry> = {}): CatalogEntry => ({
  id,
  name: id,
  description: `A made-up skill called ${id} for tests.`,
  category: "engineering",
  attribution: { name: "Someone", sourceUrl: "https://example.com", verified: false },
  enabled: true,
  isCustom: false,
  license: "MIT",
  phases: ["build"],
  domains: ["general"],
  ...extra,
});

let base: string;
let bundled: string;
let user: string;
function writeSkill(dir: string, id: string, text: string) {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "SKILL.md"), text);
}
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "omni-user-skills-"));
  bundled = join(base, "bundled");
  user = join(base, "user");
  mkdirSync(bundled);
  writeFileSync(join(bundled, "catalog.json"), JSON.stringify([entry("made-up-a"), entry("made-up-b")]));
  writeSkill(bundled, "made-up-a", "bundled a");
  writeSkill(bundled, "made-up-b", "bundled b");
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const ids = async (source: ReturnType<typeof createSkillDirectorySource>) => {
  const listed = await source.list();
  if (!listed.ok) throw new Error(JSON.stringify(listed.issues));
  return listed.entries.map((e) => `${e.id}:${e.enabled ? "on" : "off"}`);
};

describe("createSkillDirectorySource with the person's own skills", () => {
  it("serves the bundled catalog alone when the person's folder does not exist yet", async () => {
    expect(await ids(createSkillDirectorySource(bundled, { userDir: user }))).toEqual(["made-up-a:on", "made-up-b:on"]);
  });

  it("adds the person's own skill and reads its text from their folder", async () => {
    mkdirSync(user);
    writeFileSync(join(user, "catalog.json"), JSON.stringify([entry("my-own", { isCustom: true, category: "custom" })]));
    writeSkill(user, "my-own", "my own text");
    const source = createSkillDirectorySource(bundled, { userDir: user });
    expect(await ids(source)).toEqual(["made-up-a:on", "made-up-b:on", "my-own:on"]);
    expect(await source.readContent("my-own")).toBe("my own text");
  });

  it("uses the person's edit of a bundled skill instead of the bundled text", async () => {
    mkdirSync(user);
    writeFileSync(join(user, "catalog.json"), JSON.stringify([entry("made-up-a", { isCustom: true, description: "Edited by the person for tests." })]));
    writeSkill(user, "made-up-a", "edited a");
    const source = createSkillDirectorySource(bundled, { userDir: user });
    const listed = await source.list();
    expect(listed.ok && listed.entries.find((e) => e.id === "made-up-a")?.description).toBe("Edited by the person for tests.");
    expect(await source.readContent("made-up-a")).toBe("edited a");
    expect(await source.readContent("made-up-b")).toBe("bundled b");
  });

  it("marks a skill the person switched off as off, so it is never served", async () => {
    mkdirSync(user);
    writeFileSync(join(user, "skills.json"), JSON.stringify({ formatVersion: 1, skills: { "made-up-b": { enabled: false } } }));
    expect(await ids(createSkillDirectorySource(bundled, { userDir: user }))).toEqual(["made-up-a:on", "made-up-b:off"]);
  });

  it("reports an invalid file in the person's folder by name instead of skipping it", async () => {
    mkdirSync(user);
    writeFileSync(join(user, "catalog.json"), JSON.stringify([{ id: "broken" }]));
    const listed = await createSkillDirectorySource(bundled, { userDir: user }).list();
    expect(listed.ok).toBe(false);
    if (!listed.ok) expect(listed.issues.map((i) => i.message).join(" ")).toMatch(/catalog\.json/);
  });

  it("never reads outside the person's folder", async () => {
    mkdirSync(user);
    expect(await createSkillDirectorySource(bundled, { userDir: user }).readContent("../bundled/made-up-a")).toBeNull();
  });
});
