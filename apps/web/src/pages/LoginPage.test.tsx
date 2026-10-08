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
});
