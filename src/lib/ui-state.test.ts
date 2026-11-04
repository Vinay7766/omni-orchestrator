import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { forgetUiState, usePersistedState } from "./ui-state";

// Issue B: what the person typed is kept on disk (the app's ui-state.json) and read back on start.

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mocked = vi.mocked(invoke);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  forgetUiState();
  mocked.mockReset();
});

describe("usePersistedState", () => {
  it("starts from what was saved on disk", async () => {
    mocked.mockImplementation(async (cmd) => (cmd === "load_ui_state" ? JSON.stringify({ draft: { idea: "saved idea" } }) : undefined));
    const { result } = renderHook(() => usePersistedState("draft", { idea: "" }));
    await act(async () => sleep(10));
    expect(result.current[0]).toEqual({ idea: "saved idea" });
  });

  it("saves a change to disk, keeping the other saved values", async () => {
    const saved: string[] = [];
    mocked.mockImplementation(async (cmd, args) => {
      if (cmd === "load_ui_state") return JSON.stringify({ other: 1 });
      if (cmd === "save_ui_state") saved.push((args as { text: string }).text);
      return undefined;
    });
    const { result } = renderHook(() => usePersistedState("draft", { idea: "" }));
    await act(async () => sleep(10));
    act(() => result.current[1]({ idea: "typed" }));
    await act(async () => sleep(600));
    expect(JSON.parse(saved.at(-1)!)).toEqual({ other: 1, draft: { idea: "typed" } });
  });

  it("never saves before the saved values are read, so a slow start cannot wipe them", async () => {
    let release: (v: string) => void = () => {};
    const saves: string[] = [];
    mocked.mockImplementation((cmd, args) => {
      if (cmd === "load_ui_state") return new Promise<string>((r) => (release = r));
      if (cmd === "save_ui_state") saves.push((args as { text: string }).text);
      return Promise.resolve(undefined);
    });
    renderHook(() => usePersistedState("draft", { idea: "" }));
    await act(async () => sleep(600));
    expect(saves).toEqual([]);
    await act(async () => release(JSON.stringify({ draft: { idea: "kept" } })));
  });

  // RT-20 (T6.8, red-team pass 2026-11-04): a key typed into a draft must not reach the disk. Moved
  // here from src-tauri/tests/red_team_tests.rs: the app's drafts are written by this hook, and the
  // project's redaction rules live in core, so this is the path the attack takes.
  it("RT-20 (T6.8): a key typed into a draft is not written to the drafts file", async () => {
    const key = "sk" + "-proj-" + "aB3dE5gH7jK9mN1pQ2rS4tU6vW8xY0zAbCdEfGh";
    const saved: string[] = [];
    mocked.mockImplementation(async (cmd, args) => {
      if (cmd === "load_ui_state") return null;
      if (cmd === "save_ui_state") saved.push((args as { text: string }).text);
      return undefined;
    });
    const { result } = renderHook(() => usePersistedState("ideaDraft", { idea: "" }));
    await act(async () => sleep(10));
    act(() => result.current[1]({ idea: `my key is ${key}` }));
    await act(async () => sleep(600));
    expect(saved.at(-1)).toBeDefined();
    expect(saved.at(-1)).not.toContain(key);
  });
});
