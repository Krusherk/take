import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LoginPage } from "./LoginPage";

const privy = vi.hoisted(() => ({
  login: vi.fn(),
  initOAuth: vi.fn(async () => {}),
  sendCode: vi.fn(async () => {}),
}));

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: true, authenticated: false }),
  useLogin: () => ({ login: privy.login }),
  useLoginWithOAuth: () => ({ initOAuth: privy.initOAuth, state: { status: "initial" } }),
  useLoginWithEmail: () => ({ sendCode: privy.sendCode, loginWithCode: vi.fn(), state: { status: "initial" } }),
}));

describe("LoginPage (signed out)", () => {
  it("leads with one TAKE and the star logo, not a text wordmark", () => {
    render(<LoginPage navigate={vi.fn()} />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("You have one TAKE.Give it to someone else.");
    const brand = screen.getByRole("link", { name: "TAKE home" });
    expect(brand.querySelector("img")?.getAttribute("src")).toBe("/assets/sticker/logo.webp");
    expect(brand).not.toHaveTextContent("TAKE");
  });

  it("keeps the same sign-in options behind the Sign in button", () => {
    render(<LoginPage navigate={vi.fn()} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Sign in" })[0]!);
    const dialog = screen.getByRole("dialog", { name: "Join as yourself." });

    fireEvent.click(within(dialog).getByRole("button", { name: /Continue with X/ }));
    expect(privy.initOAuth).toHaveBeenCalledWith({ provider: "twitter" });

    fireEvent.click(within(dialog).getByRole("button", { name: /Use a wallet/ }));
    expect(privy.login).toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: /Continue with email/ }));
    expect(within(dialog).getByLabelText("Your email")).toBeInTheDocument();
  });

  it("tells the rest of the story as sticker sections, not the old marketing panels", () => {
    const { container } = render(<LoginPage navigate={vi.fn()} />);

    for (const name of ["Likes are endless.A TAKE is one.", "One TAKE.Pass it on.", "Any scarce spot.", "Reach doesn’tadd power.", "Who would yougive your TAKE to?"]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
    }
    for (const id of ["how-it-works", "use-cases", "why-take", "about"]) expect(container.querySelector(`#${id}`)).not.toBeNull();
    expect(screen.getAllByText("1 TAKE")).toHaveLength(3);
    expect(container.querySelector(".landing-principles, .landing-trust-band, .landing-vision-band, .landing-footer--final")).toBeNull();
    expect(container.querySelector('img[src*="take-mascot-"]')).toBeNull();
  });

  it("only says what the product does", () => {
    const { container } = render(<LoginPage navigate={vi.fn()} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Sign in" })[0]!);

    expect(screen.getByLabelText("You give your TAKE to someone else")).toBeInTheDocument();
    expect(container.querySelector('img[src*="ticket.webp"]')).toBeNull();
    expect(screen.queryByText(/kubo|sarah/i)).toBeNull();
    expect(screen.queryByText(/terms|privacy policy/i)).toBeNull();
    expect(screen.queryByText(/public and checkable|sybil/i)).toBeNull();
    expect(screen.getByText("Results after close.")).toBeInTheDocument();
  });

  it("uses the same sign-in for the final call to action", () => {
    render(<LoginPage navigate={vi.fn()} />);
    const final = screen.getByRole("region", { name: "Who would yougive your TAKE to?" });

    fireEvent.click(within(final).getByRole("button", { name: "Start a campaign" }));
    expect(screen.getByRole("dialog", { name: "Join as yourself." })).toBeInTheDocument();
    expect(window.sessionStorage.getItem("take-post-auth-destination")).toBe("/organize");
    fireEvent.click(screen.getByRole("button", { name: "Close sign in" }));

    fireEvent.click(within(final).getByRole("button", { name: "Explore campaigns" }));
    expect(screen.getByRole("dialog", { name: "Join as yourself." })).toBeInTheDocument();
    expect(window.sessionStorage.getItem("take-post-auth-destination")).toBe("/explore");
  });
});

