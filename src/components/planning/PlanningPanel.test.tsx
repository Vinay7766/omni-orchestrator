import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { PhaseHistoryEntry } from "@omni/core";
import { PlanningPanel } from "./PlanningPanel";

// E5 slice 3: in a project, the next planning phase runs with the person's model, and a phase
// waiting for review shows its document so the person can read it before deciding (GATE-2).

const entry = (phase: string, status: PhaseHistoryEntry["status"]): PhaseHistoryEntry => ({
  phase,
  status,
  isNext: true,
  submissions: [],
  changeRequests: [],
  sessions: [],
});

describe("PlanningPanel", () => {
  it("runs the next planning phase and says it is running", async () => {
    let finish: () => void = () => {};
    const run = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    render(<PlanningPanel entry={entry("idea-review", "not_started")} providerReady run={run} readDocument={vi.fn()} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /run idea-review/i }));
    });
    expect(run).toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toMatch(/running idea-review/i);
    expect((screen.getByRole("button", { name: /run idea-review/i }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finish());
  });

  it("cannot run without a model set up, and says where to set one", () => {
    render(<PlanningPanel entry={entry("research", "in_progress")} providerReady={false} run={vi.fn()} readDocument={vi.fn()} />);
    expect((screen.getByRole("button", { name: /run research/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/set up a model in settings/i)).toBeDefined();
  });

  it("tells the person their change notes go with the rerun", () => {
    render(<PlanningPanel entry={entry("prd", "changes_requested")} providerReady run={vi.fn()} readDocument={vi.fn()} />);
    expect(screen.getByText(/your change notes/i)).toBeDefined();
  });

  it("shows the document of a phase waiting for review, and no run button", async () => {
    const readDocument = vi.fn().mockResolvedValue("# Idea review\n\nVerdict: build it.");
    await act(async () => {
      render(<PlanningPanel entry={entry("idea-review", "awaiting_review")} providerReady run={vi.fn()} readDocument={readDocument} />);
    });
    expect(readDocument).toHaveBeenCalledWith("idea-review.md");
    expect(screen.getByText(/Verdict: build it\./)).toBeDefined();
    expect(screen.queryByRole("button", { name: /run/i })).toBeNull();
  });

  it("shows the stack decision record with the architecture under review", async () => {
    const readDocument = vi.fn((name: string) => Promise.resolve(name === "architecture.md" ? "# Architecture" : "# Stack decision record\n\nbest fit"));
    await act(async () => {
      render(<PlanningPanel entry={entry("architecture", "awaiting_review")} providerReady run={vi.fn()} readDocument={readDocument} />);
    });
    expect(readDocument).toHaveBeenCalledWith("architecture-stack-adr.md");
    expect(screen.getByText(/best fit/)).toBeDefined();
  });

  it("says so when the document under review is missing", async () => {
    await act(async () => {
      render(<PlanningPanel entry={entry("research", "awaiting_review")} providerReady run={vi.fn()} readDocument={vi.fn().mockResolvedValue(null)} />);
    });
    expect(screen.getByText(/docs\/planning\/research\.md was not found/)).toBeDefined();
  });

  it("shows nothing for a phase that is not a planning phase", () => {
    const { container } = render(<PlanningPanel entry={entry("build", "not_started")} providerReady run={vi.fn()} readDocument={vi.fn()} />);
    expect(container.textContent).toBe("");
  });

  // C: answer a document's open questions in a conversation, then generate the final document.
  async function reviewing(over: Partial<React.ComponentProps<typeof PlanningPanel>> = {}) {
    const props = {
      entry: entry("prd", "awaiting_review"),
      providerReady: true,
      run: vi.fn(),
      readDocument: vi.fn().mockResolvedValue("# PRD\n\nOpen question: pricing?"),
      discuss: vi.fn().mockResolvedValue({ ok: true, reply: "What should it cost?", ready: null }),
      revise: vi.fn().mockResolvedValue(undefined),
      ...over,
    };
    await act(async () => {
      render(<PlanningPanel {...props} />);
    });
    return props;
  }
  const say = async (text: string) => {
    fireEvent.change(screen.getByLabelText(/talk about this document/i), { target: { value: text } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send to the AI" }));
    });
  };

  it("lets the person talk about the document with the AI, which has the document", async () => {
    const props = await reviewing();
    await say("What is still open?");
    expect(props.discuss).toHaveBeenCalledWith("# PRD\n\nOpen question: pricing?", [{ role: "person", text: "What is still open?" }]);
    expect(screen.getByRole("log", { name: "Conversation about prd" }).textContent).toContain("What should it cost?");
  });

  it("generates the final document from the conversation, as change notes for the revision", async () => {
    const revise = vi.fn().mockResolvedValue(undefined);
    await reviewing({ revise });
    await say("Ten dollars a month");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /generate final document/i }));
    });
    expect(revise).toHaveBeenCalledTimes(1);
    const [notes, messages] = revise.mock.calls[0];
    expect(notes).toContain("You: Ten dollars a month");
    expect(notes).toContain("AI: What should it cost?");
    expect(messages).toHaveLength(2);
  });

  it("cannot generate a final document before the person has said anything", async () => {
    await reviewing();
    expect((screen.getByRole("button", { name: /generate final document/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});
