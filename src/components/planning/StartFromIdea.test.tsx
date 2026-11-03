import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { StartFromIdea } from "./StartFromIdea";

// E5 slice 2: the person types an idea and creates the project (PLAN-1); with no model set up
// they are shown the free options first (PLAN-5).

function setup(over: Partial<React.ComponentProps<typeof StartFromIdea>> = {}) {
  const props = {
    defaultParent: "C:/work",
    providerReady: true,
    create: vi.fn().mockResolvedValue({ ok: true, root: "C:/work/plant-helper" }),
    onCreated: vi.fn(),
    onOpenSettings: vi.fn(),
    ...over,
  };
  render(<StartFromIdea {...props} />);
  return props;
}

const fill = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("StartFromIdea", () => {
  it("explains the free options in plain words when no model is set up", () => {
    const props = setup({ providerReady: false });
    const guide = screen.getByRole("region", { name: /set up an ai model/i });
    expect(guide.textContent).toMatch(/on this computer/i);
    expect(guide.textContent).toMatch(/free tier/i);
    fireEvent.click(screen.getByRole("button", { name: /open settings/i }));
    expect(props.onOpenSettings).toHaveBeenCalled();
  });

  it("does not show the guide when a model is set up", () => {
    setup();
    expect(screen.queryByRole("region", { name: /set up an ai model/i })).toBeNull();
  });

  it("shows where the project folder will be", () => {
    setup();
    fill(/project name/i, "Plant Helper!");
    expect(screen.getByText("C:/work/plant-helper")).toBeDefined();
  });

  it("cannot create until there is an idea and a name", () => {
    setup();
    const button = screen.getByRole("button", { name: /create project/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fill(/your idea/i, "Reminds me to water plants");
    expect(button.disabled).toBe(true);
    fill(/project name/i, "Plant Helper");
    expect(button.disabled).toBe(false);
  });

  it("creates the project and hands over its folder", async () => {
    const props = setup();
    fill(/your idea/i, "Reminds me to water plants");
    fill(/project name/i, "Plant Helper");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /create project/i }));
    });
    expect(props.create).toHaveBeenCalledWith({ parent: "C:/work", name: "Plant Helper", idea: "Reminds me to water plants", conversation: [], summary: null });
    expect(props.onCreated).toHaveBeenCalledWith("C:/work/plant-helper", "C:/work");
  });

  it("shows the real reason when the project cannot be created", async () => {
    const props = setup({ create: vi.fn().mockResolvedValue({ ok: false, error: "A project already exists in C:/work/plant-helper." }) });
    fill(/your idea/i, "x");
    fill(/project name/i, "Plant Helper");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /create project/i }));
    });
    expect(screen.getByRole("alert").textContent).toMatch(/already exists/);
    expect(props.onCreated).not.toHaveBeenCalled();
  });

  // C: a conversation with the AI before the phases.
  const send = async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^send/i }));
    });
  };

  it("sends the person's message, shows the AI's reply in the conversation and clears the box", async () => {
    const chat = vi.fn().mockResolvedValue({ ok: true, reply: "Indoor plants, outdoor, or both?", ready: null });
    setup({ chat });
    fill(/your idea/i, "Reminds me to water plants");
    await send();
    expect(chat).toHaveBeenCalledWith([{ role: "person", text: "Reminds me to water plants" }]);
    const log = screen.getByRole("log", { name: "Conversation" });
    expect(log.textContent).toContain("Reminds me to water plants");
    expect(log.textContent).toContain("Indoor plants, outdoor, or both?");
    expect((screen.getByLabelText(/your reply/i) as HTMLTextAreaElement).value).toBe("");
  });

  it("says when the AI has understood the idea and invites the person to start the phases", async () => {
    setup({ chat: vi.fn().mockResolvedValue({ ok: true, reply: "Got it.", ready: "Reminders to water indoor plants" }) });
    fill(/your idea/i, "Reminds me to water plants");
    await send();
    const understood = screen.getByRole("status", { name: /understood/i });
    expect(understood.textContent).toContain("Reminders to water indoor plants");
    expect(understood.textContent).toMatch(/start the phases/i);
  });

  it("shows the model's real error and keeps the person's message to send again", async () => {
    setup({ chat: vi.fn().mockResolvedValue({ ok: false, error: "made-up provider: rate limit reached" }) });
    fill(/your idea/i, "Reminds me to water plants");
    await send();
    expect(screen.getByRole("alert").textContent).toMatch(/rate limit/);
    expect((screen.getByLabelText(/your idea/i) as HTMLTextAreaElement).value).toBe("Reminds me to water plants");
    expect(screen.queryByRole("log", { name: "Conversation" })).toBeNull();
  });

  it("starts the phases with the whole conversation and the agreed summary", async () => {
    const chat = vi.fn().mockResolvedValue({ ok: true, reply: "Indoor or outdoor?", ready: "Reminders to water indoor plants" });
    const props = setup({ chat });
    fill(/your idea/i, "Reminds me to water plants");
    await send();
    fill(/project name/i, "Plant Helper");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /start the phases/i }));
    });
    expect(props.create).toHaveBeenCalledWith({
      parent: "C:/work",
      name: "Plant Helper",
      idea: "Reminds me to water plants",
      conversation: [
        { role: "person", text: "Reminds me to water plants" },
        { role: "assistant", text: "Indoor or outdoor?" },
      ],
      summary: "Reminders to water indoor plants",
    });
  });

  it("cannot send to the AI without a model, but the idea can still start the phases", () => {
    setup({ providerReady: false, chat: vi.fn() });
    fill(/your idea/i, "Reminds me to water plants");
    expect((screen.getByRole("button", { name: /^send/i }) as HTMLButtonElement).disabled).toBe(true);
    fill(/project name/i, "Plant Helper");
    expect((screen.getByRole("button", { name: /start the phases/i }) as HTMLButtonElement).disabled).toBe(false);
  });
});
