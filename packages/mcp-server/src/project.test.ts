import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodeFs } from "@omni/core/node";
import { registeredProjectsFrom } from "./project.js";

// RT-14: the app's list of registered projects, the only projects besides its own a server opens.
const fs = createNodeFs();
let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("registeredProjectsFrom", () => {
  it("reads the absolute folders the app wrote", async () => {
    dir = mkdtempSync(join(tmpdir(), "omni-reg-")).replace(/\\/g, "/");
    const file = `${dir}/projects.json`;
    writeFileSync(file, JSON.stringify({ formatVersion: 1, roots: ["/repos/orbit", "C:\\Repos\\b", "relative", 7] }));
    expect(await registeredProjectsFrom(fs, file)()).toEqual(["/repos/orbit", "C:/Repos/b"]);
  });

  it("treats a missing or malformed file as no registered projects", async () => {
    dir = mkdtempSync(join(tmpdir(), "omni-reg-")).replace(/\\/g, "/");
    expect(await registeredProjectsFrom(fs, `${dir}/none.json`)()).toEqual([]);
    for (const bad of ["{", JSON.stringify({ roots: ["/a"] }), JSON.stringify({ formatVersion: 1, roots: "/a" })]) {
      writeFileSync(`${dir}/bad.json`, bad);
      expect(await registeredProjectsFrom(fs, `${dir}/bad.json`)()).toEqual([]);
    }
  });
});
