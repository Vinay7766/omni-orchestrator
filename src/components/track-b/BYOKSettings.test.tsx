import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { BYOKSettings, resolveProvider } from "./BYOKSettings";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

function open(config = {}, onChange = vi.fn()) {
  render(<BYOKSettings config={config} onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: /BYOK Configuration/ }));
  return onChange;
}

describe("resolveProvider", () => {
  it("uses the selected provider", () => {
    expect(resolveProvider({ geminiApiKey: "k", activeProvider: "compatible" })).toBe("compatible");
  });

  it("otherwise uses the first one set up, in the same order as the backend", () => {
    expect(resolveProvider({ anthropicApiKey: "k", geminiApiKey: "k" })).toBe("gemini");
    expect(resolveProvider({ ollamaEndpoint: "http://localhost:11434", compatibleBaseUrl: "http://x/v1" })).toBe("compatible");
  });

  it("is undefined when nothing is set up", () => {
    expect(resolveProvider({ geminiApiKey: "   " })).toBeUndefined();
  });
});

describe("BYOKSettings", () => {
  beforeEach(() => mockedInvoke.mockReset());

  it("offers no built-in model names", () => {
    open();
    expect((screen.getByLabelText("Model") as HTMLInputElement).value).toBe("");
    expect(document.querySelectorAll("datalist option").length).toBe(0);
    const providerOptions = Array.from((screen.getByLabelText("Provider") as HTMLSelectElement).options).map((o) => o.value);
    expect(providerOptions).toEqual(["", "gemini", "claude", "openai", "compatible", "ollama"]);
  });

  it("saves a made-up OpenAI-compatible endpoint with its model", () => {
    const onChange = open();
    fireEvent.change(screen.getByLabelText("OpenAI-compatible endpoint URL"), { target: { value: "http://localhost:8080/v1" } });
    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "compatible" } });
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "nebula-7b" } });
    fireEvent.click(screen.getByRole("button", { name: /Save Configuration/ }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ compatibleBaseUrl: "http://localhost:8080/v1", activeProvider: "compatible", preferredModel: "nebula-7b" }),
    );
  });

  it("loads the provider's own models and offers them for the model field", async () => {
    mockedInvoke.mockResolvedValueOnce(["orbit:latest", "orbit:small"]);
    open({ ollamaEndpoint: "http://localhost:11434" });
    fireEvent.click(screen.getByRole("button", { name: /Load models/ }));
    await waitFor(() => expect(screen.getByText("2 models found")).toBeDefined());
    expect(mockedInvoke).toHaveBeenCalledWith("list_byok_models", {
      byok: expect.objectContaining({ ollamaEndpoint: "http://localhost:11434" }),
      provider: "ollama",
    });
    const options = Array.from(document.querySelectorAll("datalist option")).map((o) => o.getAttribute("value"));
    expect(options).toEqual(["orbit:latest", "orbit:small"]);
  });

  it("shows the provider's error when models cannot be loaded", async () => {
    mockedInvoke.mockRejectedValueOnce("Endpoint 127.0.0.1 error 401: bad key");
    open({ compatibleBaseUrl: "http://127.0.0.1:9/v1" });
    fireEvent.click(screen.getByRole("button", { name: /Load models/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("401");
  });

  it("says when a provider lists no models, so the user types one", async () => {
    mockedInvoke.mockResolvedValueOnce([]);
    open({ ollamaEndpoint: "http://localhost:11434" });
    fireEvent.click(screen.getByRole("button", { name: /Load models/ }));
    expect(await screen.findByText(/No models listed/)).toBeDefined();
  });

  it("cannot load models before a provider is set up", () => {
    open();
    expect((screen.getByRole("button", { name: /Load models/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(mockedInvoke).not.toHaveBeenCalled();
  });
});

describe("BYOKSettings: where keys are kept (NFR-10)", () => {
  beforeEach(() => mockedInvoke.mockReset());

  it("says keys are kept in the system credential store when one is available", () => {
    render(<BYOKSettings config={{}} onChange={vi.fn()} keyStorage={{ available: true }} />);
    fireEvent.click(screen.getByRole("button", { name: /BYOK Configuration/ }));
    expect(screen.getByText(/system credential store/i)).toBeDefined();
  });

  it("warns that keys last only this session when there is no credential store, with the reason", () => {
    render(
      <BYOKSettings config={{}} onChange={vi.fn()} keyStorage={{ available: false, message: "no Secret Service running" }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /BYOK Configuration/ }));
    const warning = screen.getByRole("alert");
    expect(warning.textContent).toMatch(/re-enter/i);
    expect(warning.textContent).toMatch(/no Secret Service running/);
  });

  it("shows a save failure and stays open", async () => {
    const onChange = vi.fn().mockRejectedValue("Failed to write settings: access denied");
    render(<BYOKSettings config={{}} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /BYOK Configuration/ }));
    fireEvent.click(screen.getByRole("button", { name: /Save Configuration/ }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/access denied/);
    expect(screen.getByRole("button", { name: /Save Configuration/ })).toBeDefined();
  });

  it("shows settings that arrive after it first rendered (loaded at app start)", () => {
    const { rerender } = render(<BYOKSettings config={{}} onChange={vi.fn()} />);
    rerender(<BYOKSettings config={{ preferredModel: "made-up-model-7b" }} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /BYOK Configuration/ }));
    expect((screen.getByLabelText("Model") as HTMLInputElement).value).toBe("made-up-model-7b");
  });
});
