/**
 * Red-team tests for rendering untrusted text in the dashboard (security pass dry run,
 * 2026-11-02; report: docs/security/red-team-2026-11-02.md). Abuse cases T4.1 and T4.2 from
 * docs/threat-model.md; each asserts the SAFE outcome. `it.fails` marks an open finding.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SkillCard } from "./SkillCard";
import { TeardownViewer } from "../track-b/TeardownViewer";
import type { Skill, TeardownResponse } from "../../lib/types";

const SCRIPT = `<script>window.__redTeam = "script ran"</script>`;
const IMG = `<img src=x onerror="window.__redTeam='img ran'">`;

const skill = (overrides: Partial<Skill> = {}, sourceUrl = "https://example.com/skill"): Skill => ({
  id: "made-up",
  name: "Made-up skill",
  description: "A made-up skill.",
  category: "architecture",
  attribution: { name: "Someone", sourceUrl, verified: false },
  enabled: true,
  content: "# Made up",
  isCustom: true,
  phases: ["build"],
  ...overrides,
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { __redTeam?: string }).__redTeam;
});

const ran = () => (window as unknown as { __redTeam?: string }).__redTeam;

describe("red team: script injection through untrusted text (T4.1)", () => {
  it("RT-7 (T4.1): skill name, description and author with script and img payloads render as text", () => {
    const { container } = render(
      <SkillCard skill={skill({ name: SCRIPT, description: IMG })} onToggle={() => {}} onView={() => {}} onEdit={() => {}} />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(SCRIPT)).toBeDefined();
    expect(screen.getByText(IMG)).toBeDefined();
    expect(ran()).toBeUndefined();
  });

  it("RT-7 (T4.1): provider output (teardown report, levers, target name) renders as text", () => {
    const teardown: TeardownResponse = {
      targetName: IMG,
      markdownReport: `# Report\n${SCRIPT}\n${IMG}`,
      coldOutreachSequence: SCRIPT,
      strategicGrowthLevers: [IMG, SCRIPT],
      authorAttributions: [SCRIPT],
    };
    const { container } = render(<TeardownViewer teardown={teardown} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain(SCRIPT);
    expect(container.textContent).toContain(IMG);
    expect(ran()).toBeUndefined();
  });
});

describe("red team: unsafe link targets from user-editable skill data (T4.2)", () => {
  const sourceLink = (container: HTMLElement) => container.querySelector('a[title="View Source Repository"]') as HTMLAnchorElement;

  it("RT-8 (T4.2): a javascript: source URL never reaches the link with the attacker's code", () => {
    const { container } = render(<SkillCard skill={skill({}, "javascript:window.__redTeam='link ran'")} onToggle={() => {}} />);
    const href = sourceLink(container).getAttribute("href") ?? "";
    // React 19 replaces javascript: URLs with one that only throws; the payload must be gone.
    expect(href).not.toContain("__redTeam");
  });

  // RT-9: other non-web schemes pass straight through to href (React only blocks javascript:).
  // The threat model's preferred control is an https-only allow-list; there is none today.
  it.fails("RT-9 (T4.2): only an https: source URL is turned into a link (data: and file: are refused)", () => {
    for (const url of ["data:text/html,<script>alert(1)</script>", "file:///C:/Windows/System32/calc.exe"]) {
      const { container, unmount } = render(<SkillCard skill={skill({}, url)} onToggle={() => {}} />);
      const href = sourceLink(container)?.getAttribute("href") ?? "";
      expect(href === "" || href.startsWith("https:"), `${url} -> ${href}`).toBe(true);
      unmount();
    }
  });
});
