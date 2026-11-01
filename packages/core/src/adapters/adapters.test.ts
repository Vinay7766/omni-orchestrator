import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { adapterFor, applyManagedBlock, mcpSetupSnippet, parseAdapters, type Adapter } from "./adapters.js";
import { loadAdapterDirectory } from "./node-source.js";

const coreDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const shipped = join(coreDir, "adapters");
const shared = JSON.parse(readFileSync(join(coreDir, "test-data", "managed-block-cases.json"), "utf8")) as {
  cases: { name: string; existing: string | null; body: string; text: string; status: string }[];
};

const nebula: Adapter = {
  formatVersion: 1,
  id: "nebula",
  name: "Nebula Editor",
  matches: ["nebula", "nebula-insiders"],
  mcp: { format: "servers", userConfig: ["~/.nebula/mcp.json"], projectConfig: ".nebula/mcp.json" },
  instructionFiles: [".nebula/instructions.md"],
  sources: [{ url: "https://nebula.example/docs", checked: "2026-11-01", covers: ["mcp"] }],
};
const file = (name: string, data: unknown) => ({ name, text: JSON.stringify(data) });

describe("shipped adapters", () => {
  it("are all valid, each cites where it was checked, and no two claim the same tool", async () => {
    const { adapters, issues } = await loadAdapterDirectory(shipped);
    expect(issues).toEqual([]);
    expect(adapters.length).toBeGreaterThan(0);
    for (const a of adapters) expect(a.sources.length).toBeGreaterThan(0);
  });
});

describe("parseAdapters", () => {
  it("reports an invalid adapter by file name and keeps the valid ones", () => {
    const { adapters, issues } = parseAdapters([file("nebula.json", nebula), file("broken.json", { id: "broken" }), { name: "bad.json", text: "{ nope" }]);
    expect(adapters.map((a) => a.id)).toEqual(["nebula"]);
    expect(issues.map((i) => i.file)).toEqual(["broken.json", "bad.json"]);
  });

  it("requires the file name to match the adapter id", () => {
    const { issues } = parseAdapters([file("other.json", nebula)]);
    expect(issues[0].message).toMatch(/nebula\.json/);
  });

  it("refuses two adapters claiming the same discovered tool", () => {
    const twin = { ...nebula, id: "nebula-twin", matches: ["nebula"] };
    const { adapters, issues } = parseAdapters([file("nebula.json", nebula), file("nebula-twin.json", twin)]);
    expect(adapters.map((a) => a.id)).toEqual(["nebula"]);
    expect(issues[0].message).toMatch(/nebula/);
  });
});

describe("adapterFor", () => {
  it("finds the adapter by any of the ids discovery gives the tool", () => {
    expect(adapterFor("nebula-insiders", [nebula])?.id).toBe("nebula");
    expect(adapterFor("a-tool-nobody-named", [nebula])).toBeUndefined();
  });
});

describe("applyManagedBlock (cases shared with the Rust launcher)", () => {
  for (const c of shared.cases) {
    it(c.name, () => {
      expect(applyManagedBlock(c.existing, c.body)).toEqual({ text: c.text, status: c.status });
    });
  }
});

describe("mcpSetupSnippet", () => {
  const server = { name: "omni-orchestrator", command: "omni-mcp", args: ["--stdio"] };

  it("without an adapter gives the common mcpServers form and generic directions", () => {
    const s = mcpSetupSnippet(server);
    expect(s.generic).toBe(true);
    expect(JSON.parse(s.json)).toEqual({ mcpServers: { "omni-orchestrator": { command: "omni-mcp", args: ["--stdio"] } } });
    expect(s.locations).toEqual([]);
  });

  it("with an adapter uses the tool's own format and says where the file goes", () => {
    const s = mcpSetupSnippet(server, nebula);
    expect(s.generic).toBe(false);
    expect(Object.keys(JSON.parse(s.json))).toEqual(["servers"]);
    expect(s.locations).toEqual(["~/.nebula/mcp.json", "<project>/.nebula/mcp.json"]);
  });
});

describe("bundledAdaptersDir", () => {
  it("points at the shipped adapters folder", async () => {
    const { bundledAdaptersDir } = await import("./node-source.js");
    expect((await loadAdapterDirectory(bundledAdaptersDir())).adapters.length).toBeGreaterThan(0);
  });

  it("a missing folder means no adapters, not an error", async () => {
    expect(await loadAdapterDirectory(join(coreDir, "no-such-folder"))).toEqual({ adapters: [], issues: [] });
  });
});
