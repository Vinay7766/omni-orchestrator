import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { PhaseHistoryEntry } from "@omni/core";
import { PhaseActions, type PhaseDecisions } from "./PhaseActions";

const entry = (over: Partial<PhaseHistoryEntry> & { phase: string }): PhaseHistoryEntry => ({
  status: "not_started",
  isNext: false,
  submissions: [],
  changeRequests: [],
  sessions: [],
  ...over,
});

function decisions() {
  return {
    approve: vi.fn<PhaseDecisions["approve"]>(() => Promise.resolve()),
    requestChanges: vi.fn<PhaseDecisions["requestChanges"]>(() => Promise.resolve()),
    run: vi.fn<PhaseDecisions["run"]>(() => Promise.resolve()),
    skip: vi.fn<PhaseDecisions["skip"]>(() => Promise.resolve()),
    withdraw: vi.fn<NonNullable<PhaseDecisions["withdraw"]>>(() => Promise.resolve()),
  };
}

describe("PhaseActions (E3 slice 3)", () => {
  it("offers Approve and Request changes for a phase awaiting review", async () => {
    const d = decisions();
    render(<PhaseActions entry={entry({ phase: "prd", status: "awaiting_review" })} decisions={d} />);
    fireEvent.click(screen.getByRole("button", { name: 'Approve "prd"' }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Yes, approve" })));
    expect(d.approve).toHaveBeenCalledWith("prd");
  });

  // Owner's v0.1 issue D (2026-11-04): approving asks once more, and can be undone.
  it("asks to confirm before approving, and cancelling approves nothing", () => {
    const d = decisions();
    render(<PhaseActions entry={entry({ phase: "prd", status: "awaiting_review" })} decisions={d} />);
    fireEvent.click(screen.getByRole("button", { name: 'Approve "prd"' }));
    expect(screen.getByRole("alertdialog", { name: /approve "prd"\?/i }).textContent).toMatch(/next phase/i);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(d.approve).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("offers to undo the latest approval", async () => {
    const d = decisions();
    render(<PhaseActions entry={entry({ phase: "prd", status: "approved" })} decisions={d} latestApproval />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: 'Undo approval of "prd"' })));
    expect(d.withdraw).toHaveBeenCalledWith("prd");
  });

  it("does not offer undo on an older approval", () => {
    render(<PhaseActions entry={entry({ phase: "prd", status: "approved" })} decisions={decisions()} />);
    expect(screen.queryByRole("button", { name: /undo approval/i })).toBeNull();
  });

  it("sends change notes only when there are some", async () => {
    const d = decisions();
    render(<PhaseActions entry={entry({ phase: "prd", status: "awaiting_review" })} decisions={d} />);
    fireEvent.click(screen.getByRole("button", { name: "Request changes" }));
    const send = screen.getByRole("button", { name: "Send the changes" });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("What should change?"), { target: { value: "Add the risks section" } });
    await act(async () => fireEvent.click(send));
    expect(d.requestChanges).toHaveBeenCalledWith("prd", "Add the risks section");
  });

  it("offers Run it and Skip it, with an optional reason, for an optional phase waiting for the person", async () => {
    const d = decisions();
    render(<PhaseActions entry={entry({ phase: "security-pass", isNext: true, optionalQuestion: "Run it?" })} decisions={d} />);
    fireEvent.change(screen.getByLabelText("Reason for skipping (optional)"), { target: { value: "Internal prototype" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: 'Skip "security-pass"' })));
    expect(d.skip).toHaveBeenCalledWith("security-pass", "Internal prototype");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: 'Run "security-pass"' })));
    expect(d.run).toHaveBeenCalledWith("security-pass");
  });

  it("offers nothing for a phase with no decision to make", () => {
    const { container } = render(
      <>
        <PhaseActions entry={entry({ phase: "idea-review", status: "approved" })} decisions={decisions()} />
        <PhaseActions entry={entry({ phase: "build", status: "in_progress", isNext: true })} decisions={decisions()} />
        <PhaseActions entry={entry({ phase: "security-pass", optionalQuestion: "Run it?" })} decisions={decisions()} />
      </>,
    );
    expect(container.querySelectorAll("button").length).toBe(0);
  });

  it("disables its buttons while a decision is being saved", async () => {
    let finish!: () => void;
    const d = decisions();
    d.approve.mockImplementation(() => new Promise<void>((r) => (finish = r)));
    render(<PhaseActions entry={entry({ phase: "prd", status: "awaiting_review" })} decisions={d} />);
    fireEvent.click(screen.getByRole("button", { name: 'Approve "prd"' }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, approve" }));
    expect((screen.getByRole("button", { name: 'Approve "prd"' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finish());
  });
});
