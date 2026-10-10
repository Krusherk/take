import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HowItWorksPage } from "./HowItWorksPage";

describe("HowItWorksPage eligibility stack", () => {
  it("lists every evidence signal and integrity chip with no status tags", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ campaigns: [] }))));
    const { container } = render(<HowItWorksPage navigate={vi.fn()} signedIn={false} />);
    const stack = screen.getByRole("group", { name: "Eligibility evidence stack" });
    expect(stack.querySelectorAll(".hiw-layer")).toHaveLength(9);
    expect(screen.getByText("Appeals")).toBeInTheDocument();
    expect(screen.getByText("eligible = 1 TAKE")).toBeInTheDocument();
    expect(screen.getByText("Coalitions")).toBeInTheDocument();
    expect(container.querySelectorAll(".hiw-tag")).toHaveLength(0);
    const text = (container.textContent ?? "").toLowerCase();
    for (const gone of ["not yet in create flow", "currently reports unavailable", "coming next", "planned"]) expect(text).not.toContain(gone);
    vi.unstubAllGlobals();
  });
});
