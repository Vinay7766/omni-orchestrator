import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MemoryFs } from "./fs.js";
import { createNodeFs } from "./node-fs.js";
import { createInvokeFs, MEMORY_FS_COMMANDS } from "./invoke-fs.js";

/**
 * Executes memfs_* commands the way the Rust side does, using the Node adapter. This checks
 * the invoke adapter's argument names and return conventions; Rust's own behaviour and path
 * policy are tested in src-tauri/tests/memory_fs_tests.rs.
 */
function fakeInvoke(): (cmd: string, args: Record<string, unknown>) => Promise<unknown> {
  const node = createNodeFs();
  const handlers: Record<string, (a: Record<string, string>) => Promise<unknown>> = {
    memfs_read_text: (a) => node.readText(a.path),
    memfs_write_text: (a) => node.writeText(a.path, a.content),
    memfs_append_text: (a) => node.appendText(a.path, a.content),
    memfs_create_exclusive: (a) => node.createExclusive(a.path, a.content),
    memfs_exists: (a) => node.exists(a.path),
    memfs_mkdir: (a) => node.mkdir(a.path),
    memfs_rename: (a) => node.rename(a.from, a.to),
    memfs_remove: (a) => node.remove(a.path),
    memfs_list: (a) => node.list(a.path),
  };
  return async (cmd, args) => {
    const handler = handlers[cmd];
    if (!handler) throw new Error(`unknown command ${cmd}`);
    return handler(args as Record<string, string>);
  };
}

/** The behaviour every MemoryFs implementation must share. */
function memoryFsContract(name: string, makeFs: () => MemoryFs) {
  describe(`MemoryFs contract: ${name}`, () => {
    let dir: string;
    let fs: MemoryFs;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "omni-fs-")).replace(/\\/g, "/");
      fs = makeFs();
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it("returns null for a missing file and the text for an existing one", async () => {
      expect(await fs.readText(`${dir}/missing.txt`)).toBeNull();
      await fs.writeText(`${dir}/a.txt`, "hello");
      expect(await fs.readText(`${dir}/a.txt`)).toBe("hello");
    });

    it("appends and creates the file if needed", async () => {
      await fs.appendText(`${dir}/log.jsonl`, "1\n");
      await fs.appendText(`${dir}/log.jsonl`, "2\n");
      expect(await fs.readText(`${dir}/log.jsonl`)).toBe("1\n2\n");
    });

    it("creates exclusively: true the first time, false when the file exists", async () => {
      expect(await fs.createExclusive(`${dir}/lock`, "a")).toBe(true);
      expect(await fs.createExclusive(`${dir}/lock`, "b")).toBe(false);
      expect(await fs.readText(`${dir}/lock`)).toBe("a");
    });

    it("reports existence, creates nested folders and lists entries", async () => {
      expect(await fs.exists(`${dir}/x/y`)).toBe(false);
      await fs.mkdir(`${dir}/x/y`);
      expect(await fs.exists(`${dir}/x/y`)).toBe(true);
      await fs.writeText(`${dir}/x/one.txt`, "1");
      expect((await fs.list(`${dir}/x`)).sort()).toEqual(["one.txt", "y"]);
      expect(await fs.list(`${dir}/nope`)).toEqual([]);
    });

    it("renames over an existing file and removes files idempotently", async () => {
      await fs.writeText(`${dir}/new.json`, "new");
      await fs.writeText(`${dir}/state.json`, "old");
      await fs.rename(`${dir}/new.json`, `${dir}/state.json`);
      expect(await fs.readText(`${dir}/state.json`)).toBe("new");
      expect(await fs.exists(`${dir}/new.json`)).toBe(false);
      await fs.remove(`${dir}/state.json`);
      await fs.remove(`${dir}/state.json`);
      expect(await fs.exists(`${dir}/state.json`)).toBe(false);
    });
  });
}

memoryFsContract("Node", createNodeFs);
memoryFsContract("invoke (desktop)", () => createInvokeFs(fakeInvoke()));

describe("createInvokeFs", () => {
  it("uses exactly the commands the Rust side registers", () => {
    expect([...MEMORY_FS_COMMANDS].sort()).toEqual(
      ["memfs_append_text", "memfs_create_exclusive", "memfs_exists", "memfs_list", "memfs_mkdir", "memfs_read_text", "memfs_remove", "memfs_rename", "memfs_write_text"].sort(),
    );
  });

  it("passes the Rust side's refusal through as an error", async () => {
    const refusing = createInvokeFs(async () => {
      throw "path is outside a .agents folder";
    });
    await expect(refusing.writeText("/etc/passwd", "x")).rejects.toThrow(/outside a \.agents folder/);
  });
});
