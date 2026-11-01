import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { GlobalResearchHub } from "./GlobalResearchHub";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockImplementation((cmd: string, args: any) => {
    if (cmd === "search_research_skills") {
      const allSkills = [
        {
          id: "github-trend-playwright-automation",
          name: "Playwright E2E Resilience Engineer",
          description: "Auto-recovering Playwright test suite generator",
          sourceUrl: "https://github.com/microsoft/playwright",
          author: "Microsoft & Community",
          domain: "DevOps",
          starsOrUpvotes: 3420,
          content: "# Playwright",
          imported: false,
        },
        {
          id: "github-trend-owasp-audit",
          name: "OWASP API Security Auditor",
          description: "Automated static analysis",
          sourceUrl: "https://github.com/OWASP/API-Security",
          author: "OWASP Foundation",
          domain: "Security",
          starsOrUpvotes: 5120,
          content: "# OWASP",
          imported: false,
        },
      ];
      const domain = args?.query?.domainOrCategory;
      if (!domain || domain === "All") return Promise.resolve(allSkills);
      return Promise.resolve(
        allSkills.filter((s) => s.domain.toLowerCase() === domain.toLowerCase())
      );
    }
    return Promise.resolve([]);
  }),
}));

describe("GlobalResearchHub Component", () => {
  it("renders domain chips and filters cards by domain", async () => {
    const handleImport = vi.fn();
    render(<GlobalResearchHub onImportToLibrary={handleImport} />);

    // Check chips
    expect(screen.getByRole("button", { name: "DevOps" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Security" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Marketing" })).toBeDefined();

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByText("OWASP API Security Auditor")).toBeDefined();
    });

    // Click "Security" chip
    fireEvent.click(screen.getByRole("button", { name: "Security" }));

    // Verify security card is visible
    await waitFor(() => {
      expect(screen.getByText("OWASP API Security Auditor")).toBeDefined();
      expect(screen.queryByText("Playwright E2E Resilience Engineer")).toBeNull();
    });
  });

  it("triggers 1-Click Add to Library callback", async () => {
    const handleImport = vi.fn();
    render(<GlobalResearchHub onImportToLibrary={handleImport} />);

    await waitFor(() => {
      const addButtons = screen.getAllByText(/Add to Library/i);
      expect(addButtons.length).toBeGreaterThan(0);
    });

    const addButtons = screen.getAllByText(/Add to Library/i);
    fireEvent.click(addButtons[0]);
    expect(handleImport).toHaveBeenCalledTimes(1);
  });
});
