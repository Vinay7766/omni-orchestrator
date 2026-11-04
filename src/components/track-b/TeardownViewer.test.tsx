import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TeardownViewer } from "./TeardownViewer";
import type { TeardownResponse } from "../../lib/types";

describe("TeardownViewer Component", () => {
  const mockTeardown: TeardownResponse = {
    targetName: "Superhuman",
    markdownReport: "# Executive Teardown: Superhuman\n\nAnalyzed keyboard loops and VIP onboarding.",
    coldOutreachSequence: "Subject: Superhuman onboarding loop insights\n\nHi Rahul, loved the speed.",
    strategicGrowthLevers: ["VIP Onboarding Streamlining", "Referral Viral Loop"],
    authorAttributions: ["Yan Liu (Product Teardown)", "Corey Haines (Customer Research)"],
  };

  it("renders target name, growth levers, and author attributions", () => {
    render(<TeardownViewer teardown={mockTeardown} />);

    expect(screen.getByRole("heading", { name: /Executive Teardown: Superhuman/i })).toBeDefined();
    expect(screen.getByText(/VIP Onboarding Streamlining/i)).toBeDefined();
    expect(screen.getByText(/Yan Liu \(Product Teardown\)/i)).toBeDefined();
    expect(screen.getByText(/Corey Haines \(Customer Research\)/i)).toBeDefined();
  });

  it("switches tabs to cold outreach pitch and allows copying", async () => {
    // Mock navigator.clipboard
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockImplementation(() => Promise.resolve()),
      },
    });

    render(<TeardownViewer teardown={mockTeardown} />);

    // Click outreach tab
    const outreachTab = screen.getByRole("button", { name: /Cold Outreach Pitch Sequence/i });
    fireEvent.click(outreachTab);

    expect(screen.getByText(/Superhuman onboarding loop insights/i)).toBeDefined();

    const copyBtn = screen.getByRole("button", { name: /Copy Sequence/i });
    fireEvent.click(copyBtn);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(mockTeardown.coldOutreachSequence);
    expect(await screen.findByText(/Copied to Clipboard/i)).toBeDefined();
  });

  it("says the Markdown file was saved, and keeps the file's link until the save has started (issue D)", () => {
    vi.useFakeTimers();
    const revoke = vi.fn();
    URL.createObjectURL = vi.fn(() => "blob:made-up");
    URL.revokeObjectURL = revoke;
    render(<TeardownViewer teardown={mockTeardown} />);
    fireEvent.click(screen.getByRole("button", { name: "Download Markdown" }));
    expect(screen.getByRole("status").textContent).toMatch(/strategic-teardown\.md/);
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith("blob:made-up");
    vi.useRealTimers();
  });
});
