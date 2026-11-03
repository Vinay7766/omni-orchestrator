import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { TaskProposalPanel } from "./TaskProposalPanel";

// E5 slice 5: the AI writes the task list; the person reads it (titles, requirement ids and the
// kinds of work as text) and approves it or asks for changes. There is no way to edit it here.

const PROPOSAL = {
  ok: true as const,
  model: "made-up-model",
  tasks: [
    { taskId: "T-1", title: "Shopping list data model", requirements: ["REQ-1"], kinds: ["backend", "tests"] },
    { taskId: "T-2", title: "List screen", kinds: ["interface"] },
  ],
};

async function setup(over: Partial<React.ComponentProps<typeof TaskProposalPanel>> = {}) {
  const props = {
    providerReady: true,
    read: vi.fn().mockResolvedValue(PROPOSAL),
    propose: vi.fn().mockResolvedValue(undefined),
    approve: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
  await act(async () => {
    render(<TaskProposalPanel {...props} />);
  });
  return props;
}

describe("TaskProposalPanel", () => {
  it("offers to have the model write the list when none is proposed yet", async () => {
    const props = await setup({ read: vi.fn().mockResolvedValue({ ok: false, error: "No task list has been proposed yet." }) });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /write the task list/i }));
    });
    expect(props.propose).toHaveBeenCalledWith(undefined);
    expect(props.read).toHaveBeenCalledTimes(2);
  });

  it("cannot ask for a list without a model set up", async () => {
    await setup({ providerReady: false, read: vi.fn().mockResolvedValue({ ok: false, error: "No task list has been proposed yet." }) });
    expect((screen.getByRole("button", { name: /write the task list/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows each task with its requirements and kinds as text, and who wrote the list", async () => {
    await setup();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toMatch(/T-1.*Shopping list data model/);
    expect(items[0].textContent).toMatch(/REQ-1/);
    expect(items[0].textContent).toMatch(/backend/);
    expect(items[0].textContent).toMatch(/tests/);
    expect(screen.getByText(/made-up-model/)).toBeDefined();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("approves the list as written", async () => {
    const props = await setup();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /approve the task list/i }));
    });
    expect(props.approve).toHaveBeenCalled();
  });

  it("sends the person's notes so the model rewrites the list", async () => {
    const props = await setup();
    fireEvent.click(screen.getByRole("button", { name: /request changes/i }));
    const rewrite = screen.getByRole("button", { name: /rewrite the list/i }) as HTMLButtonElement;
    expect(rewrite.disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: /what should change/i }), { target: { value: "Split T-1" } });
    await act(async () => {
      fireEvent.click(rewrite);
    });
    expect(props.propose).toHaveBeenCalledWith("Split T-1");
  });

  it("shows why a saved list cannot be used", async () => {
    await setup({ read: vi.fn().mockResolvedValue({ ok: false, error: "The model's task list could not be used: task 2 has no title" }) });
    expect(screen.getByText(/task 2 has no title/)).toBeDefined();
    expect(screen.getByRole("button", { name: /write the task list/i })).toBeDefined();
  });

  it("shows which tool and model each task is for, and why (D)", async () => {
    await setup({
      read: vi.fn().mockResolvedValue({
        ...PROPOSAL,
        tasks: [{ taskId: "T-1", title: "List screen", kinds: ["interface"], assignedTool: "made-up-editor", assignedModel: "made-up-large", assignmentReason: "Strong at interface work" }],
      }),
    });
    const item = screen.getByText("List screen").closest("li")!;
    expect(item.textContent).toContain("made-up-editor");
    expect(item.textContent).toContain("made-up-large");
    expect(item.textContent).toContain("Strong at interface work");
  });
});
