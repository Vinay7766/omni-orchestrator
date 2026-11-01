import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SkillCard } from "./SkillCard";
import { Skill } from "../../lib/types";

describe("SkillCard Component", () => {
  const mockSkill: Skill = {
    id: "spec-driven-development",
    name: "Spec-Driven Development",
    description: "Establishes formal PRD and specifications before code.",
    category: "architecture",
    attribution: {
      name: "Addy Osmani",
      role: "Head of Chrome DX",
      sourceUrl: "https://github.com/addyosmani/agent-skills",
      verified: true,
    },
    enabled: true,
    content: "# Spec",
    isCustom: false,
    phaseScope: "spec",
  };

  it("renders skill title, description, and author attribution correctly", () => {
    render(<SkillCard skill={mockSkill} onToggle={vi.fn()} />);

    expect(screen.getByText("Spec-Driven Development")).toBeDefined();
    expect(screen.getByText("Addy Osmani")).toBeDefined();
    expect(screen.getByTestId("verified-badge")).toBeDefined();
    expect(screen.getByText("spec")).toBeDefined();
  });

  it("triggers onToggle callback when switch is clicked", () => {
    const handleToggle = vi.fn();
    render(<SkillCard skill={mockSkill} onToggle={handleToggle} />);

    const checkbox = screen.getByLabelText("Toggle Spec-Driven Development");
    fireEvent.click(checkbox);

    expect(handleToggle).toHaveBeenCalledWith("spec-driven-development", false);
  });
});
