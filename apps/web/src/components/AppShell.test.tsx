import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { personFromMe } from "../lib/currentIdentity";
import { xConnectedMe } from "../test/identityFixture";
import { AppShell } from "./AppShell";

describe("authenticated account shell", () => {
  it("renders the real TAKE identity instead of a mock authenticated user", () => {
    render(
      <AppShell
        path="/home"
        navigate={vi.fn()}
        unreadCount={0}
        currentPerson={personFromMe(xConnectedMe)}
        onLogout={vi.fn()}
      >
        <p>Private home</p>
      </AppShell>,
    );

    expect(screen.getByText("Real X Person")).toBeInTheDocument();
    expect(screen.getByText("@realxperson")).toBeInTheDocument();
    expect(screen.queryByText("Kubo")).not.toBeInTheDocument();
  });

  it("exposes real logout from the custom account menu", async () => {
    const onLogout = vi.fn().mockResolvedValue(undefined);
    render(
      <AppShell
        path="/home"
        navigate={vi.fn()}
        unreadCount={0}
        currentPerson={personFromMe(xConnectedMe)}
        onLogout={onLogout}
      >
        <p>Private home</p>
      </AppShell>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open account menu for Real X Person" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "LOG OUT" }));
    await waitFor(() => expect(onLogout).toHaveBeenCalledTimes(1));
  });
});
