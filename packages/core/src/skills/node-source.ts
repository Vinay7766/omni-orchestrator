import { promises as fsp } from "node:fs";
import { join } from "node:path";
import { validateMemoryFile } from "../validate.js";
import type { SkillSource } from "./resolve.js";

/** Same rule as the catalog schema's id: also guarantees the id is a single safe folder name. */
const SKILL_ID = /^[a-z0-9][a-z0-9-]*$/;

/** SkillSource reading a skills folder laid out as catalog.json + <id>/SKILL.md. */
export function createSkillDirectorySource(skillsDir: string): SkillSource {
  return {
    async list() {
      let raw: string;
      try {
        raw = await fsp.readFile(join(skillsDir, "catalog.json"), "utf8");
      } catch (error) {
        return { ok: false, issues: [{ path: "", message: `cannot read the skill catalog in ${skillsDir}: ${String(error)}` }] };
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return { ok: false, issues: [{ path: "", message: "skills/catalog.json is not valid JSON" }] };
      }
      const result = validateMemoryFile("skill-catalog", parsed);
      return result.ok ? { ok: true, entries: result.value } : result;
    },
    async readContent(id) {
      if (!SKILL_ID.test(id)) return null;
      try {
        // Same normalisation as the Rust build: content is always LF.
        return (await fsp.readFile(join(skillsDir, id, "SKILL.md"), "utf8")).replace(/\r\n/g, "\n");
      } catch {
        return null;
      }
    },
  };
}
