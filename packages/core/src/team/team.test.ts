import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../memory/store.js";
import { createNodeFs } from "../memory/node-fs.js";
import { readTeam, saveTeam, TEAM_FILE } from "./team.js";

// The tools the person selected for a project (TOOL-2), in .agents/team.json.

const fs = createNodeFs();
const person = { kind: "human" as const, tool: "omni-desktop" };
const agent = { kind: "agent" as const, tool: "omni-desktop", model: "some-model" };
const editor = { toolId: "example-editor", name: "Example Editor", capability: 3 as const, confirmedByPerson: false };
const chat = { toolId: "chat-site", name: "Chat Site", capability: 1 as const, confirmedByPerson: true };
let root: string;
let store: MemoryStore;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "omni-team-")).replace(/\\/g, "/");
  const created = await MemoryStore.create(fs, root, { name: "p", flow: "build", mode: "full", actor: person });
  if (!created.ok) throw new Error(JSON.stringify(created.issues));
  store = created.store;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("team (core)", () => {
  it("has no team before the person selects tools", async () => {
    expect(await readTeam(store)).toEqual({ ok: true, team: null });
  });

  it("saves the selection and reads it back", async () => {
    const saved = await saveTeam({ store, fs, root }, person, [editor, chat], "2026-11-03T10:00:00Z");
    expect(saved.ok).toBe(true);
    const read = await readTeam(store);
    expect(read).toEqual({
      ok: true,
      team: {
        formatVersion: 1,
        updatedAt: "2026-11-03T10:00:00Z",
        members: [
          { ...editor, addedAt: "2026-11-03T10:00:00Z" },
          { ...chat, addedAt: "2026-11-03T10:00:00Z" },
        ],
      },
    });
  });

  it("records the selection as the person's decision, pointing at team.json", async () => {
    await saveTeam({ store, fs, root }, person, [editor, chat], "2026-11-03T10:00:00Z");
    const last = (await store.readEvents()).events.at(-1)!;
    expect(last.type).toBe("decision_recorded");
    expect(last.actor).toEqual(person);
    expect(last.refs).toEqual({ files: [`.agents/${TEAM_FILE}`] });
    expect(JSON.stringify(last.payload)).toContain("Example Editor (level 3)");
    expect(JSON.stringify(last.payload)).toContain("Chat Site (level 1, confirmed by the person)");
  });

  it("keeps when each tool was first added when the selection changes", async () => {
    await saveTeam({ store, fs, root }, person, [editor], "2026-11-03T10:00:00Z");
    await saveTeam({ store, fs, root }, person, [editor, chat], "2026-11-03T11:00:00Z");
    const read = await readTeam(store);
    expect(read.ok && read.team?.members.map((m) => m.addedAt)).toEqual(["2026-11-03T10:00:00Z", "2026-11-03T11:00:00Z"]);
    expect(read.ok && read.team?.updatedAt).toBe("2026-11-03T11:00:00Z");
  });

  it("records an empty selection honestly", async () => {
    const saved = await saveTeam({ store, fs, root }, person, [], "2026-11-03T10:00:00Z");
    expect(saved.ok).toBe(true);
    const last = (await store.readEvents()).events.at(-1)!;
    expect(JSON.stringify(last.payload)).toContain("No tools selected");
  });

  it("refuses a selection made by an agent, and writes nothing", async () => {
    const saved = await saveTeam({ store, fs, root }, agent, [editor], "2026-11-03T10:00:00Z");
    expect(saved.ok).toBe(false);
    if (!saved.ok) expect(saved.message).toMatch(/person/);
    expect(existsSync(join(root, ".agents", TEAM_FILE))).toBe(false);
  });

  it("refuses the same tool twice, and writes nothing", async () => {
    const saved = await saveTeam({ store, fs, root }, person, [editor, { ...editor, capability: 2 }], "2026-11-03T10:00:00Z");
    expect(saved.ok).toBe(false);
    expect(existsSync(join(root, ".agents", TEAM_FILE))).toBe(false);
  });

  it("reports a damaged team.json instead of treating it as no team", async () => {
    writeFileSync(join(root, ".agents", TEAM_FILE), "{ not json");
    const read = await readTeam(store);
    expect(read.ok).toBe(false);
    writeFileSync(join(root, ".agents", TEAM_FILE), JSON.stringify({ formatVersion: 1, members: [] }));
    expect((await readTeam(store)).ok).toBe(false);
  });
});
