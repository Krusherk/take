import { render, screen, within } from "@testing-library/react";
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
  it("explains the sandbox and Signal honestly", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ campaigns: [] }))));
    render(<HowItWorksPage navigate={vi.fn()} signedIn={false} />);
    expect(screen.getByText("Sandbox campaigns")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Signal" })).toBeInTheDocument();
    expect(screen.getByText(/every score is 0 today/)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
  it("keeps the beats in plain words and puts the contract under the hood", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ campaigns: [] }))));
    const { container } = render(<HowItWorksPage navigate={vi.fn()} signedIn={false} />);
    const beats = container.querySelector(".hiw-beats")!;
    expect(beats.querySelectorAll("code")).toHaveLength(1);
    for (const code of ["giveTake", "createCampaign", "activateCampaign", "finalizeAllocation", "TakeCampaignManager", "verify:rules"]) expect(beats.textContent).not.toContain(code);
    expect(screen.getByText("Rules get locked.")).toBeInTheDocument();
    expect(screen.getByText("You give your TAKE.")).toBeInTheDocument();
    expect(screen.getByText("The result is final.")).toBeInTheDocument();
    const hood = screen.getByRole("region", { name: "Under the hood" });
    expect(within(hood).getByRole("link", { name: /TakeCampaignManager/ })).toHaveAttribute("href", "https://testnet.monadexplorer.com/address/0xc3a0178b31d8844455c49988736d51a2336056e5");
    for (const fn of ["createCampaign", "activateCampaign", "giveTake", "finalizeAllocation", "pnpm verify:rules"]) expect(within(hood).getByText(fn)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
