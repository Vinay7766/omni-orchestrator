import { promises as fsp } from "node:fs";
import { join } from "node:path";
import { validateMemoryFile, type ValidationIssue } from "../validate.js";
import type { CatalogEntry, SkillSource } from "./resolve.js";

/** Same rule as the catalog schema's id: also guarantees the id is a single safe folder name. */
const SKILL_ID = /^[a-z0-9][a-z0-9-]*$/;

type Read<T> = { ok: true; value: T | null } | { ok: false; issues: ValidationIssue[] };

/** Reads and validates one JSON file; a missing file is `null`, any other problem names the file. */
async function readJson<K extends "skill-catalog" | "skills-config">(path: string, kind: K): Promise<Read<unknown>> {
  let raw: string;
  try {
    raw = await fsp.readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ok: true, value: null };
    return { ok: false, issues: [{ path: "", message: `cannot read ${path}: ${String(error)}` }] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, issues: [{ path: "", message: `${path} is not valid JSON` }] };
  }
  const result = validateMemoryFile(kind, parsed);
  if (!result.ok) return { ok: false, issues: result.issues.map((i) => ({ ...i, message: `${path}: ${i.message}` })) };
  return { ok: true, value: result.value };
}

async function readSkillText(dir: string, id: string): Promise<string | null> {
  try {
    // Same normalisation as the Rust build: content is always LF.
    return (await fsp.readFile(join(dir, id, "SKILL.md"), "utf8")).replace(/\r\n/g, "\n");
  } catch {
    return null;
  }
}

export interface SkillDirectoryOptions {
  /**
   * The person's own skills folder (SKL-5), laid out like the bundled one: catalog.json and
   * <id>/SKILL.md for skills they added or edited, and skills.json for skills switched on or off.
   * Its entries replace bundled ones with the same id; its text is read first.
   */
  userDir?: string;
}

/** SkillSource reading a skills folder laid out as catalog.json + <id>/SKILL.md. */
export function createSkillDirectorySource(skillsDir: string, options: SkillDirectoryOptions = {}): SkillSource {
  const { userDir } = options;
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
      if (!result.ok || !userDir) return result.ok ? { ok: true, entries: result.value } : result;

      const own = await readJson(join(userDir, "catalog.json"), "skill-catalog");
      if (!own.ok) return own;
      const states = await readJson(join(userDir, "skills.json"), "skills-config");
      if (!states.ok) return states;

      const entries = new Map<string, CatalogEntry>(result.value.map((e) => [e.id, e]));
      for (const e of (own.value as CatalogEntry[] | null) ?? []) entries.set(e.id, e);
      const switched = ((states.value as { skills: Record<string, { enabled?: boolean }> } | null)?.skills ?? {}) as Record<string, { enabled?: boolean }>;
      return {
        ok: true,
        entries: [...entries.values()].map((e) => (switched[e.id]?.enabled === undefined ? e : { ...e, enabled: switched[e.id].enabled as boolean })),
      };
    },
    async readContent(id) {
      if (!SKILL_ID.test(id)) return null;
      if (userDir) {
        const own = await readSkillText(userDir, id);
        if (own !== null) return own;
      }
      return readSkillText(skillsDir, id);
    },
  };
}
