import { describe, it, expect, vi, beforeEach } from "vitest";
import { openUrl } from "@tauri-apps/plugin-opener";
import { openExternal, safeExternalUrl } from "./external-link";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn().mockResolvedValue(undefined) }));

describe("safeExternalUrl (RT-9)", () => {
  it("accepts an https link", () => {
    expect(safeExternalUrl("https://git-scm.com/downloads")).toBe("https://git-scm.com/downloads");
  });

  it("refuses every other scheme, links with credentials, and text that is not a link", () => {
    for (const bad of [
      "data:text/html,<script>alert(1)</script>",
      "file:///C:/Windows/System32/calc.exe",
      "javascript:alert(1)",
      "http://example.com",
      "mailto:a@example.com",
      "https://user:secret@example.com/",
      "not a link",
      "",
    ]) {
      expect(safeExternalUrl(bad), bad).toBeNull();
    }
  });
});

describe("openExternal", () => {
  beforeEach(() => vi.mocked(openUrl).mockClear());

  it("opens a safe link with the system browser", async () => {
    await openExternal("https://github.com/signup");
    expect(openUrl).toHaveBeenCalledWith("https://github.com/signup");
  });

  it("never passes an unsafe link to the opener", async () => {
    await expect(openExternal("file:///etc/passwd")).rejects.toThrow(/not opened/);
    expect(openUrl).not.toHaveBeenCalled();
  });
});
