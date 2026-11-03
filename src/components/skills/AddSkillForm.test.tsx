import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { AddSkillForm, parseSkillFile } from "./AddSkillForm";

// SKL-5 / SKL-6 (tester feedback 4): the person adds a skill of their own, written or uploaded.

const fill = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

function fillRequired() {
  fill(/^name/i, "My Review Checklist");
  fill(/^description \(when/i, "Checks a change against my own review list.");
  fill(/skill text/i, "Step 1: read the diff.");
  fill(/author/i, "The person");
  fill(/source link/i, "https://example.com/checklist");
  fill(/license/i, "MIT");
  fireEvent.click(screen.getByRole("checkbox", { name: "review" }));
}

describe("parseSkillFile", () => {
  it("reads the name and description from a SKILL.md header and keeps the whole text", () => {
    const text = "---\nname: made-up-skill\ndescription: Does a made-up thing for tests.\n---\n\n# Body\n";
    expect(parseSkillFile(text)).toEqual({ name: "made-up-skill", description: "Does a made-up thing for tests.", content: text });
  });

  it("keeps the text as it is when there is no header", () => {
    expect(parseSkillFile("# Just a body\n")).toEqual({ name: "", description: "", content: "# Just a body\n" });
  });
});

describe("AddSkillForm", () => {
  it("sends the person's skill with an id made from its name and the phases chosen", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<AddSkillForm onAdd={onAdd} onClose={() => {}} />);
    fillRequired();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add skill/i }));
    });
    expect(onAdd).toHaveBeenCalledWith({
      id: "my-review-checklist",
      name: "My Review Checklist",
      description: "Checks a change against my own review list.",
      content: "Step 1: read the diff.",
      phases: ["review"],
      author: "The person",
      sourceUrl: "https://example.com/checklist",
      license: "MIT",
    });
  });

  it("fills the form from an uploaded SKILL.md", async () => {
    render(<AddSkillForm onAdd={vi.fn()} onClose={() => {}} />);
    const file = new File(["---\nname: uploaded-skill\ndescription: An uploaded skill for tests here.\n---\nBODY"], "SKILL.md", { type: "text/markdown" });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/upload a skill\.md/i), { target: { files: [file] } });
    });
    expect((screen.getByLabelText(/^name/i) as HTMLInputElement).value).toBe("uploaded-skill");
    expect((screen.getByLabelText("Description (when tools should use it)") as HTMLInputElement).value).toBe("An uploaded skill for tests here.");
    expect((screen.getByLabelText(/skill text/i) as HTMLTextAreaElement).value).toContain("BODY");
  });

  it("refuses a skill whose text contains a key, before anything is saved (MEM-6)", async () => {
    const onAdd = vi.fn();
    render(<AddSkillForm onAdd={onAdd} onClose={() => {}} />);
    fillRequired();
    fill(/skill text/i, "Use key sk" + "-proj-" + "aB3dE5gH7jK9mN1pQ2rS4tU6vW8xY0zAbCdEfGh here");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add skill/i }));
    });
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/key|secret/i);
  });

  it("shows why the app refused the skill, keeping what was typed", async () => {
    const onAdd = vi.fn().mockRejectedValue("A skill called 'my-review-checklist' already exists.");
    render(<AddSkillForm onAdd={onAdd} onClose={() => {}} />);
    fillRequired();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add skill/i }));
    });
    expect(screen.getByRole("alert").textContent).toMatch(/already exists/);
    expect((screen.getByLabelText(/^name/i) as HTMLInputElement).value).toBe("My Review Checklist");
  });

  it("keeps Add skill off until every required field and a phase are filled", () => {
    render(<AddSkillForm onAdd={vi.fn()} onClose={() => {}} />);
    expect((screen.getByRole("button", { name: /add skill/i }) as HTMLButtonElement).disabled).toBe(true);
    fillRequired();
    expect((screen.getByRole("button", { name: /add skill/i }) as HTMLButtonElement).disabled).toBe(false);
  });
});
