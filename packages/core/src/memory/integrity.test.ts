import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "./store.js";
import { createNodeFs } from "./node-fs.js";
import { PhaseEngine } from "../engine/phases.js";
import { createKeySigner, createKeyTrust, generateSigningKey } from "./node-trust.js";
import { decisionMessage, describeFinding, sha256Hex } from "./integrity.js";

// C17: chained log, signed person decisions, and what each tool counts.
const fs = createNodeFs();
const person = { kind: "human" as const, tool: "omni-desktop" };
const agent = { kind: "agent" as const, tool: "any-ai-tool" };
const key = generateSigningKey();
const trust = createKeyTrust({ app: key.publicKey });
const signer = createKeySigner("app", key.privateKey);

let root: string;
const log = () => join(root, ".agents", "events.jsonl");
const lines = () => readFileSync(log(), "utf8").split("\n").filter((l) => l !== "");

async function submitted(options: Parameters<typeof MemoryStore.create>[3]) {
  const created = await MemoryStore.create(fs, root, { name: "p", flow: "build", mode: "full", actor: person }, options);
  if (!created.ok) throw new Error(JSON.stringify(created.issues));
  const engine = new PhaseEngine(created.store);
  expect((await engine.start(agent, "idea-review")).ok).toBe(true);
  await created.store.appendEvent({ type: "memory_updated", actor: agent, payload: { files: [".agents/summary.md"] } });
  const s = await engine.submit(agent, { phase: "idea-review", documents: ["docs/IDEA.md"], skillsUsed: [{ skill: "s", evidence: "e" }], understandingCheck: "docs/u.md" });
  expect(s.ok).toBe(true);
  return { store: created.store, engine };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "omni-integrity-")).replace(/\\/g, "/");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("the chained log", () => {
  it("chains every new line to the one before it", async () => {
    await submitted({});
    const all = lines();
    expect(JSON.parse(all[0]).prev).toBe(await sha256Hex(""));
    for (let i = 1; i < all.length; i++) expect(JSON.parse(all[i]).prev).toBe(await sha256Hex(all[i - 1]));
  });

  it("reports an edited earlier line where the chain breaks", async () => {
    const { store } = await submitted({});
    const all = lines();
    const edited = JSON.parse(all[1]);
    edited.payload = { phase: "research" };
    all[1] = JSON.stringify(edited);
    writeFileSync(log(), all.join("\n") + "\n");
    const report = await store.integrity();
    expect(report.findings).toContainEqual(expect.objectContaining({ kind: "chain_broken", line: 3 }));
    expect(describeFinding(report.findings.find((f) => f.kind === "chain_broken")!)).toMatch(/history was changed/);
  });

  it("counts only the first of two events with the same id (a replayed decision)", async () => {
    const { store, engine } = await submitted({ trust, signer });
    expect((await engine.approve(person, "idea-review")).ok).toBe(true);
    expect((await engine.withdrawApproval(person, "idea-review")).ok).toBe(true);
    const approval = lines().find((l) => JSON.parse(l).type === "phase_approved")!;
    writeFileSync(log(), readFileSync(log(), "utf8") + approval + "\n");
    const reopened = await MemoryStore.open(fs, root, { trust });
    if (!reopened.ok) throw new Error("open");
    expect((await reopened.store.readState()).phases["idea-review"].status).toBe("awaiting_review");
    expect((await store.integrity()).findings.some((f) => f.kind === "duplicate_id")).toBe(true);
  });
});

describe("signed person decisions", () => {
  it("signs a person's decision and counts it where the key is trusted", async () => {
    const { engine } = await submitted({ trust, signer });
    expect((await engine.approve(person, "idea-review")).ok).toBe(true);
    const approval = JSON.parse(lines().at(-1)!);
    expect(approval.signature).toEqual({ keyId: "app", value: expect.any(String) });
    const reopened = await MemoryStore.open(fs, root, { trust });
    if (!reopened.ok) throw new Error("open");
    expect((await reopened.store.readState()).phases["idea-review"].status).toBe("approved");
    expect((await reopened.store.integrity()).findings).toEqual([]);
  });

  it("records nothing when the person does not confirm", async () => {
    const declining = createKeySigner("app", key.privateKey, async () => false);
    const { store, engine } = await submitted({ trust, signer: declining });
    const before = lines().length;
    const result = await engine.approve(person, "idea-review");
    expect(result.ok).toBe(false);
    expect(lines().length).toBe(before);
    expect((await store.readState()).phases["idea-review"].status).toBe("awaiting_review");
  });

  it("refuses a decision where decisions are verified but cannot be signed", async () => {
    const { engine } = await submitted({ trust });
    const result = await engine.approve(person, "idea-review");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0].message).toMatch(/signed by the OmniOrchestrator app/);
  });

  it("does not count a decision signed by a key that is not trusted", async () => {
    const other = generateSigningKey();
    const { engine } = await submitted({ trust, signer: createKeySigner("app", other.privateKey) });
    expect((await engine.approve(person, "idea-review")).ok).toBe(true);
    const reopened = await MemoryStore.open(fs, root, { trust });
    if (!reopened.ok) throw new Error("open");
    expect((await reopened.store.readState()).phases["idea-review"].status).toBe("awaiting_review");
    expect((await reopened.store.integrity()).findings).toContainEqual(expect.objectContaining({ kind: "bad_signature" }));
  });

  it("does not count a signed decision copied from another project", async () => {
    const { engine } = await submitted({ trust, signer });
    expect((await engine.approve(person, "idea-review")).ok).toBe(true);
    const copied = lines().at(-1)!;
    const firstRoot = root;
    root = mkdtempSync(join(tmpdir(), "omni-integrity-")).replace(/\\/g, "/");
    try {
      const second = await submitted({ trust, signer });
      writeFileSync(log(), readFileSync(log(), "utf8") + copied + "\n");
      expect((await second.store.readState()).phases["idea-review"].status).toBe("awaiting_review");
    } finally {
      rmSync(firstRoot, { recursive: true, force: true });
    }
  });

  it("still counts unsigned decisions from before the log was chained, and says they are not signed", async () => {
    const { store, engine } = await submitted({});
    expect((await engine.approve(person, "idea-review")).ok).toBe(true);
    // A project from before C17: no line carries prev or a signature.
    writeFileSync(log(), lines().map((l) => { const e = JSON.parse(l); delete e.prev; return JSON.stringify(e); }).join("\n") + "\n");
    const reopened = await MemoryStore.open(fs, root, { trust });
    if (!reopened.ok) throw new Error("open");
    expect((await reopened.store.readState()).phases["idea-review"].status).toBe("approved");
    expect((await reopened.store.integrity()).findings).toEqual([expect.objectContaining({ kind: "unsigned_decision", counted: true })]);
    expect(store).toBeDefined();
  });
});

describe("cross-language (src-tauri/tests/decisions_tests.rs)", () => {
  it("builds the text Rust reads, and verifies the signature Rust makes for it", async () => {
    const message = decisionMessage("proj-1", {
      id: "evt-1",
      time: "2026-11-04T10:00:00.000Z",
      type: "phase_approved",
      actor: { kind: "human", tool: "omni-desktop" },
      payload: { phase: "prd" },
    });
    expect(message).toBe('omni-decision-v1\n{"project":"proj-1","id":"evt-1","time":"2026-11-04T10:00:00.000Z","type":"phase_approved","actor":{"kind":"human","tool":"omni-desktop"},"payload":{"phase":"prd"}}');
    const rust = createKeyTrust({ "omni-desktop-ea4a6c63e29c": "6kpsY+KcUgq+9VB7Ey7F+ZVHdq6+vnuSQh7qaRRG0iw=" });
    const signature = "a9GX1P7cXu3lc0abHBy9JJVY5xLXka4xS0vl2tSHC7a1PWCYElUPppabt5B19hzvghcEiNTm3gg54o53h+lDCQ==";
    expect(await rust.verify([{ keyId: "omni-desktop-ea4a6c63e29c", message, signature }, { keyId: "omni-desktop-ea4a6c63e29c", message: message.replace("prd", "build"), signature }])).toEqual([true, false]);
  });
});
