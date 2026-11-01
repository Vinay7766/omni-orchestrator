import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";

let shouldThrow = true;
function Flaky() {
  if (shouldThrow) throw new Error("GitHub payload missing field");
  return <p>Panel content</p>;
}

describe("ErrorBoundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    shouldThrow = true;
  });

  it("contains a crash, shows the real error, and recovers on retry", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onClose = vi.fn();

    render(
      <ErrorBoundary panelName="Research Hub" onClose={onClose}>
        <Flaky />
      </ErrorBoundary>
    );

    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.getByText("Research Hub stopped working")).toBeDefined();
    expect(screen.getByText("GitHub payload missing field")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();

    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(screen.getByText("Panel content")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
