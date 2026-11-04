import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// P-A10-08: the web view may open https links only; nothing else from the opener plugin.

const capability = JSON.parse(readFileSync(join(process.cwd(), "src-tauri", "capabilities", "default.json"), "utf8")) as {
  permissions: (string | { identifier: string; allow?: { url?: string }[] })[];
};

describe("the main window's capability", () => {
  it("allows the opener for https links only", () => {
    const opener = capability.permissions.filter((p) => (typeof p === "string" ? p : p.identifier).startsWith("opener:"));
    expect(opener).toEqual([{ identifier: "opener:allow-open-url", allow: [{ url: "https://*" }] }]);
  });

  it("allows only the folder picker from the dialog plugin (issue D)", () => {
    const dialog = capability.permissions.filter((p) => (typeof p === "string" ? p : p.identifier).startsWith("dialog:"));
    expect(dialog).toEqual(["dialog:allow-open"]);
  });
});
