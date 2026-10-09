import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "./LoginPage";

vi.mock("../lib/privy", () => ({
  loadPrivy: vi.fn(),
  usePrivy: () => ({ ready: true, authenticated: false }),
  useLogin: () => ({ login: vi.fn() }),
  useLoginWithOAuth: () => ({ initOAuth: vi.fn(), state: { status: "initial" } }),
  useLoginWithEmail: () => ({ sendCode: vi.fn(), loginWithCode: vi.fn(), state: { status: "initial" } }),
}));

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Load the app stylesheets in the same order main.tsx imports them, so the real cascade decides.
function appStylesheets(): string[] {
  const main = readFileSync(resolve(srcDir, "main.tsx"), "utf8");
  return [...main.matchAll(/import\s+"\.\/([^"]+\.css)"/g)].map((match) => match[1]!);
}

describe("LoginPage sign-in sheet layout", () => {
  let styles: HTMLStyleElement[] = [];

  beforeEach(() => {
    const files = appStylesheets();
    expect(files).toContain("sticker-surfaces.css");
    styles = files.map((file) => {
      const style = document.createElement("style");
      style.textContent = readFileSync(resolve(srcDir, file), "utf8");
      document.head.appendChild(style);
      return style;
    });
  });

  afterEach(() => styles.forEach((style) => style.remove()));

  it("pins the sheet to the viewport so the hero 'Start a campaign' tap shows it", () => {
    render(<LoginPage navigate={vi.fn()} />);

    fireEvent.click(screen.getAllByRole("button", { name: /Start a campaign/ })[0]!);
    const layer = screen.getByRole("dialog", { name: "Join as yourself." }).closest(".landing-auth-layer");

    expect(layer).not.toBeNull();
    expect(layer!.parentElement).toHaveClass("landing-page");
    expect(getComputedStyle(layer!).position).toBe("fixed");
  });
});
