/// <reference types="node" />
// Runs in Node under Vitest; the app itself is browser-only, so Node types are scoped to this file.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// The desktop web view may only talk to the app itself and Tauri IPC. All outbound
// network calls (LLM providers) go through the Rust backend, never the web view.
const config = JSON.parse(readFileSync(join(__dirname, "..", "src-tauri", "tauri.conf.json"), "utf8"));
const csp: string = config.app.security.csp;
const directive = (name: string) =>
  (csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(name + " ")) ?? "").split(/\s+/).slice(1);

describe("desktop content security policy", () => {
  it("lets the web view connect only to itself and Tauri IPC", () => {
    expect(directive("connect-src").sort()).toEqual(["'self'", "http://ipc.localhost", "ipc:"].sort());
  });

  it("never allows eval in scripts", () => {
    expect(directive("script-src")).not.toContain("'unsafe-eval'");
  });
});
