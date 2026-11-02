import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ProjectDetailsForm } from "./ProjectDetailsForm";

describe("ProjectDetailsForm (E3 slice 4b)", () => {
  it("starts from the current values and saves only what changed", async () => {
    const onSave = vi.fn(() => Promise.resolve());
    render(<ProjectDetailsForm name="Orbit" mode="full" onSave={onSave} />);
    const save = () => screen.getByRole("button", { name: "Save details" }) as HTMLButtonElement;
    expect((screen.getByLabelText("Project name") as HTMLInputElement).value).toBe("Orbit");
    expect(save().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Mode"), { target: { value: "simple" } });
    expect(save().disabled).toBe(false);
    await act(async () => fireEvent.click(save()));
    expect(onSave).toHaveBeenCalledWith({ mode: "simple" });
  });

  it("does not save an empty name", () => {
    render(<ProjectDetailsForm name="Orbit" mode="full" onSave={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "   " } });
    expect((screen.getByRole("button", { name: "Save details" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("explains what simple mode means", () => {
    render(<ProjectDetailsForm name="Orbit" mode="full" onSave={vi.fn()} />);
    expect(screen.getByText(/one tool, plain-language errors/i)).toBeDefined();
  });
});
