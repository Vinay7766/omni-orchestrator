import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { PhaseHistoryEntry } from "@omni/core";
import { PhaseActions, type PhaseDecisions } from "./PhaseActions";

const entry = (over: Partial<PhaseHistoryEntry> & { phase: string }): PhaseHistoryEntry => ({
  status: "not_started",
  isNext: false,
  submissions: [],
  changeRequests: [],
  ...over,
});

function decisions() {
  return {
    approve: vi.fn<PhaseDecisions["approve"]>(() => Promise.resolve()),
    requestChanges: vi.fn<PhaseDecisions["requestChanges"]>(() => Promise.resolve()),
    run: vi.fn<PhaseDecisions["run"]>(() => Promise.resolve()),
    skip: vi.fn<PhaseDecisions["skip"]>(() => Promise.resolve()),
  };
}

describe("PhaseActions (E3 slice 3)", () => {
  it("offers Approve and Request changes for a phase awaiting review", async () => {
    const d = decisions();
    render(<PhaseActions entry={entry({ phase: "prd", status: "awaiting_review" })} decisions={d} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: 'Approve "prd"' })));
    expect(d.approve).toHaveBeenCalledWith("prd");
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
    expect((screen.getByRole("button", { name: 'Approve "prd"' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finish());
  });
});
