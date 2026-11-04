import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
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

  // Retest bug 4 (2026-11-04): the person chooses where the file goes, in the system's save dialog.
  it("saves through the system's save dialog and says where", async () => {
    const onExport = vi.fn().mockResolvedValue("D:/Docs/made-up-co-strategic-teardown.md");
    render(<TeardownViewer teardown={mockTeardown} onExport={onExport} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download Markdown" }));
    });
    expect(onExport.mock.calls[0][0]).toMatch(/strategic-teardown\.md$/);
    expect(onExport.mock.calls[0][1]).toContain(mockTeardown.markdownReport);
    expect(screen.getByRole("status").textContent).toContain("D:/Docs/made-up-co-strategic-teardown.md");
  });

  it("says nothing was saved when the dialog is cancelled, and shows a real error", async () => {
    const cancel = vi.fn().mockResolvedValue(null);
    const { unmount } = render(<TeardownViewer teardown={mockTeardown} onExport={cancel} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download Markdown" }));
    });
    expect(screen.getByRole("status").textContent).toMatch(/not saved/i);
    unmount();
    const fail = vi.fn().mockRejectedValue("Could not write D:/Docs/x.md: access denied");
    render(<TeardownViewer teardown={mockTeardown} onExport={fail} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download Markdown" }));
    });
    expect(screen.getByRole("alert").textContent).toMatch(/access denied/);
  });
});
