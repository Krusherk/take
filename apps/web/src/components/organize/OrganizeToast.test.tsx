import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrganizeToast, type OrganizeToastMessage } from "./OrganizeToast";

afterEach(() => vi.useRealTimers());

describe("OrganizeToast", () => {
  it("hides a success message by itself", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const toast: OrganizeToastMessage = { id: 1, tone: "success", title: "Campaign created." };
    render(<OrganizeToast toast={toast} onDismiss={onDismiss} />);
    expect(screen.getByRole("status")).toHaveTextContent("Campaign created.");
    act(() => { vi.advanceTimersByTime(6100); });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("keeps an action-needed message until it is dismissed", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<OrganizeToast toast={{ id: 2, tone: "action", title: "Saved as a draft.", body: "A TAKE operator has to finish it." }} onDismiss={onDismiss} />);
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByText("NEXT STEP")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss message" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("announces errors assertively and closes on Escape", () => {
    const onDismiss = vi.fn();
    render(<OrganizeToast toast={{ id: 3, tone: "error", title: "The campaign was not created." }} onDismiss={onDismiss} />);
    expect(screen.getByRole("alert")).toHaveTextContent("The campaign was not created.");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalled();
  });
});
