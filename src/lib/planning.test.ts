// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "@omni/core";
import { createNodeFs } from "@omni/core/node";
import { createProjectFromIdea, hasProvider, projectFolderName } from "./planning";
import { fakeInvoke, appStoreOptions } from "./testing/fake-invoke";

// E5 slice 2: a project starts in the app from the person's idea (PLAN-1).

const node = createNodeFs();
let base: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "omni-app-planning-")).replace(/\\/g, "/");
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe("createProjectFromIdea", () => {
  it("creates the project in a folder named after it and saves the idea", async () => {
    const r = await createProjectFromIdea(fakeInvoke(), { parent: base, name: "Plant Watering Helper", idea: "Remind me to water each plant." });
    expect(r).toEqual({ ok: true, root: `${base}/plant-watering-helper` });

    const opened = await MemoryStore.open(node, `${base}/plant-watering-helper`, appStoreOptions());
    if (!opened.ok) throw new Error(JSON.stringify(opened.issues));
    expect(opened.store.readProject()).toMatchObject({ name: "Plant Watering Helper", flow: "build", mode: "full" });
    const created = (await opened.store.readEvents()).events[0];
    expect(created.actor.kind).toBe("human");
    expect(readFileSync(`${base}/plant-watering-helper/docs/planning/idea.md`, "utf8")).toContain("Remind me to water each plant.");
  });

  it("saves the conversation before planning as the idea, so every phase reads it (C)", async () => {
    const conversation = [
      { role: "person" as const, text: "Remind me to water each plant." },
      { role: "assistant" as const, text: "Indoor plants, outdoor, or both?" },
      { role: "person" as const, text: "Indoor only." },
    ];
    const r = await createProjectFromIdea(fakeInvoke(), { parent: base, name: "Plant Helper", idea: "Remind me to water each plant.", conversation, summary: "Reminders to water indoor plants" });
    expect(r.ok).toBe(true);
    const idea = readFileSync(`${base}/plant-helper/docs/planning/idea.md`, "utf8");
    expect(idea).toContain("Reminders to water indoor plants");
    expect(idea).toContain("**You:** Indoor only.");
    expect(idea).toContain("**AI:** Indoor plants, outdoor, or both?");
  });

  it("creates the project in simple mode for a person who asked for guidance (G, NTU-2)", async () => {
    const r = await createProjectFromIdea(fakeInvoke(), { parent: base, name: "Guided", idea: "x", mode: "simple" });
    expect(r.ok).toBe(true);
    const opened = await MemoryStore.open(node, `${base}/guided`, appStoreOptions());
    expect(opened.ok && opened.store.readProject().mode).toBe("simple");
  });

  it("refuses a relative parent folder", async () => {
    const r = await createProjectFromIdea(fakeInvoke(), { parent: "projects", name: "Orbit", idea: "x" });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/full path/);
  });

  it("refuses an empty idea", async () => {
    const r = await createProjectFromIdea(fakeInvoke(), { parent: base, name: "Orbit", idea: "   " });
    expect(r).toMatchObject({ ok: false });
    expect(existsSync(`${base}/orbit`)).toBe(false);
  });

  it("refuses a name with no letters or digits", async () => {
    const r = await createProjectFromIdea(fakeInvoke(), { parent: base, name: "!!!", idea: "x" });
    expect(r).toMatchObject({ ok: false });
  });

  it("does not touch an existing project's idea", async () => {
    await createProjectFromIdea(fakeInvoke(), { parent: base, name: "Orbit", idea: "first idea" });
    const again = await createProjectFromIdea(fakeInvoke(), { parent: base, name: "Orbit", idea: "second idea" });
    expect(again).toMatchObject({ ok: false });
    if (!again.ok) expect(again.error).toMatch(/already/);
    expect(readFileSync(`${base}/orbit/docs/planning/idea.md`, "utf8")).toContain("first idea");
  });
});

describe("projectFolderName", () => {
  it("keeps lowercase letters and digits joined by single dashes", () => {
    expect(projectFolderName("  My Plant App! v2 ")).toBe("my-plant-app-v2");
    expect(projectFolderName("***")).toBe("");
  });
});

describe("hasProvider", () => {
  it("is false when nothing is set up", () => {
    expect(hasProvider({})).toBe(false);
    expect(hasProvider({ openaiApiKey: "  " })).toBe(false);
  });
  it("is true when any key or local address is set up", () => {
    expect(hasProvider({ ollamaEndpoint: "http://localhost:11434" })).toBe(true);
    expect(hasProvider({ anthropicApiKey: "k" })).toBe(true);
  });
});
